import type { HubEventEnvelope } from "@cline/shared";
import type {
	WebviewInboundMessage,
	WebviewQuestionRequest,
} from "../webview-protocol";
import type { HubContext } from "./state";
import { broadcastHubState } from "./state-payloads";
import { asRecord, asString } from "./utils";

/**
 * Follow-up questions (`ask_question` / `ask_followup_question`).
 *
 * Two shapes, mirrored onto the same browser card:
 *
 * - **Owned sessions** (created from the dashboard, or loaded into the hub by
 *   it): the dashboard contributes the `askQuestion` tool executor, so the
 *   agent parks on `requestQuestionFromWebview` until a peer answers.
 * - **Other clients' sessions** (Cline Desktop, CLI): the hub routes the
 *   `tool_executor.askQuestion` capability request to the owning client, and
 *   `capability.respond` from any other client is refused. The dashboard mirrors
 *   the broadcast request so a phone can see it, relays the answer, and when the
 *   hub refuses that answer it delivers it as the next prompt instead of leaving
 *   the turn parked until the owning client times out.
 */

const QUESTION_TIMEOUT_MS = 10 * 60_000;
const ASK_QUESTION_CAPABILITY = "tool_executor.askQuestion";

/**
 * Answers handed back to the agent when nobody answered. The tool takes a
 * string, so a legible sentence beats a rejected tool call.
 */
export const QUESTION_ANSWER_NO_PEER =
	"No Cline Hub browser client is attached to this session, so the user did not answer.";
export const QUESTION_ANSWER_TIMEOUT =
	"No answer was received before the question timed out.";
export const QUESTION_ANSWER_SESSION_ENDED =
	"The session ended before the question was answered.";
export const QUESTION_ANSWER_ABORTED =
	"The turn was aborted before the question was answered.";
export const QUESTION_ANSWER_HUB_DETACHED =
	"The dashboard left the hub before the question was answered.";

function createQuestionId(): string {
	return `question-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeOptions(options: readonly string[]): string[] {
	return options
		.map((option) => option.trim())
		.filter((option) => option.length > 0)
		.slice(0, 5);
}

function sendQuestionResolved(
	ctx: HubContext,
	sessionId: string,
	questionId: string,
	answer: string,
): void {
	ctx.sendToSelectedPeers(sessionId, {
		type: "question_resolved",
		questionId,
		answer,
	});
}

/**
 * Park the agent's `ask_question` call on the browser peers watching the
 * session, mirroring how tool approvals are raised.
 */
export function requestQuestionFromWebview(
	ctx: HubContext,
	request: {
		sessionId: string;
		question: string;
		options: readonly string[];
	},
): Promise<string> {
	const question = request.question.trim();
	const options = normalizeOptions(request.options);
	if (!question) {
		return Promise.resolve(QUESTION_ANSWER_NO_PEER);
	}
	if (!ctx.hasSelectedPeer(request.sessionId)) {
		return Promise.resolve(QUESTION_ANSWER_NO_PEER);
	}

	const questionId = createQuestionId();
	ctx.pushEvent(
		"Question requested",
		"Cline is waiting for an answer to a question",
		"warn",
	);
	broadcastHubState(ctx);

	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			resolveQuestion(ctx, questionId, QUESTION_ANSWER_TIMEOUT);
		}, QUESTION_TIMEOUT_MS);
		ctx.pendingQuestions.set(questionId, {
			sessionId: request.sessionId,
			resolve,
			timeout,
		});
		const payload: WebviewQuestionRequest = {
			type: "question_request",
			questionId,
			sessionId: request.sessionId,
			question,
			options,
			createdAt: Date.now(),
		};
		ctx.sendToSelectedPeers(request.sessionId, payload);
	});
}

export function resolveQuestion(
	ctx: HubContext,
	questionId: string,
	answer: string,
): boolean {
	const pending = ctx.pendingQuestions.get(questionId);
	if (!pending) return false;
	clearTimeout(pending.timeout);
	ctx.pendingQuestions.delete(questionId);
	sendQuestionResolved(ctx, pending.sessionId, questionId, answer);
	pending.resolve(answer);
	return true;
}

export function resolveQuestionsForSession(
	ctx: HubContext,
	sessionId: string,
	answer: string,
): void {
	for (const questionId of [...ctx.pendingQuestions.keys()]) {
		if (ctx.pendingQuestions.get(questionId)?.sessionId === sessionId) {
			resolveQuestion(ctx, questionId, answer);
		}
	}
	for (const requestId of [...ctx.remoteQuestions.keys()]) {
		if (ctx.remoteQuestions.get(requestId)?.sessionId !== sessionId) continue;
		ctx.remoteQuestions.delete(requestId);
		sendQuestionResolved(ctx, sessionId, requestId, answer);
	}
}

export function resolveAllPendingQuestions(
	ctx: HubContext,
	answer: string,
): void {
	for (const questionId of [...ctx.pendingQuestions.keys()]) {
		resolveQuestion(ctx, questionId, answer);
	}
	for (const [requestId, remote] of [...ctx.remoteQuestions.entries()]) {
		ctx.remoteQuestions.delete(requestId);
		sendQuestionResolved(ctx, remote.sessionId, requestId, answer);
	}
}

/** A peer went away: a question nobody can answer must not park the agent. */
export function resolveOrphanedQuestions(ctx: HubContext): void {
	for (const questionId of [...ctx.pendingQuestions.keys()]) {
		const pending = ctx.pendingQuestions.get(questionId);
		if (pending && !ctx.hasSelectedPeer(pending.sessionId)) {
			resolveQuestion(ctx, questionId, QUESTION_ANSWER_NO_PEER);
		}
	}
	for (const [requestId, remote] of [...ctx.remoteQuestions.entries()]) {
		if (ctx.hasSelectedPeer(remote.sessionId)) continue;
		ctx.remoteQuestions.delete(requestId);
		sendQuestionResolved(ctx, remote.sessionId, requestId, "");
	}
}

/**
 * Answer for a question this dashboard owns. Returns false when the id belongs
 * to a mirrored (remote) question, which the caller relays to the hub.
 */
export function handleLocalQuestionResponse(
	ctx: HubContext,
	frame: Extract<WebviewInboundMessage, { type: "question_response" }>,
): boolean {
	const questionId = frame.questionId.trim();
	if (!questionId) return true;
	const resolved = resolveQuestion(ctx, questionId, frame.answer);
	if (!resolved) {
		console.warn(`Ignoring unknown question response: ${questionId}`);
	}
	return resolved;
}

function parseQuestionArgs(payload: Record<string, unknown> | undefined): {
	question: string;
	options: string[];
} {
	const args = Array.isArray(payload?.args) ? payload.args : [];
	const question = typeof args[0] === "string" ? args[0].trim() : "";
	const options = Array.isArray(args[1])
		? normalizeOptions(
				(args[1] as unknown[]).filter(
					(option): option is string => typeof option === "string",
				),
			)
		: [];
	return { question, options };
}

/**
 * Mirror follow-up questions raised inside sessions owned by other hub clients.
 * Capability requests are broadcast to every subscriber, so the dashboard can
 * show them; only the owning client may answer, which is why an answer is
 * relayed and falls back to a prompt.
 */
export function observeHubEventForQuestions(
	ctx: HubContext,
	event: HubEventEnvelope,
): void {
	if (event.event === "capability.requested") {
		if (asString(event.payload?.capabilityName) !== ASK_QUESTION_CAPABILITY) {
			return;
		}
		const sessionId = event.sessionId?.trim();
		const requestId = asString(event.payload?.requestId);
		if (!sessionId || !requestId) return;
		const targetClientId = asString(event.payload?.targetClientId) ?? "";
		if (targetClientId && targetClientId === ctx.cline?.getHubClientId?.()) {
			// Our own executor raises this question under its own id.
			return;
		}
		const { question, options } = parseQuestionArgs(
			asRecord(event.payload?.payload),
		);
		if (!question) return;
		ctx.remoteQuestions.set(requestId, {
			sessionId,
			requestId,
			targetClientId,
			question,
			options,
		});
		ctx.pushEvent(
			"Question requested",
			`Cline is waiting for an answer in ${sessionId}`,
			"warn",
		);
		broadcastHubState(ctx);
		ctx.sendToSelectedPeers(sessionId, {
			type: "question_request",
			questionId: requestId,
			sessionId,
			question,
			options,
			remote: true,
			createdAt: Date.now(),
		});
		return;
	}
	if (event.event === "capability.resolved") {
		const requestId = asString(event.payload?.requestId);
		if (!requestId) return;
		const remote = ctx.remoteQuestions.get(requestId);
		if (!remote) return;
		ctx.remoteQuestions.delete(requestId);
		const answer = asString(asRecord(event.payload?.payload)?.result) ?? "";
		sendQuestionResolved(ctx, remote.sessionId, requestId, answer);
	}
}

/**
 * Relay a browser answer for a mirrored question.
 *
 * The hub accepts `capability.respond` only from the session's owning client.
 * When it refuses, the parked turn is aborted (which cancels the pending
 * capability request hub-side) and the answer is delivered as the next prompt,
 * so a phone user is never left waiting for a desktop window they are not near.
 */
export async function answerRemoteQuestion(
	ctx: HubContext,
	questionId: string,
	answer: string,
	deliverAsPrompt: (
		sessionId: string,
		answer: string,
	) => Promise<string | undefined>,
): Promise<void> {
	const remote = ctx.remoteQuestions.get(questionId);
	if (!remote) {
		ctx.broadcast({
			type: "status",
			text: "That question is no longer pending.",
		});
		return;
	}

	let relayError: string | undefined;
	try {
		const reply = await ctx.uiClient?.sendCommand(
			"capability.respond",
			{ requestId: questionId, ok: true, payload: { result: answer } },
			remote.sessionId,
		);
		if (reply?.ok) {
			ctx.remoteQuestions.delete(questionId);
			sendQuestionResolved(ctx, remote.sessionId, questionId, answer);
			ctx.sendToSelectedPeers(remote.sessionId, {
				type: "status",
				text: "Answer sent to Cline.",
			});
			return;
		}
		relayError = reply?.error?.message ?? "The hub refused this answer.";
	} catch (error) {
		relayError = error instanceof Error ? error.message : String(error);
	}

	const promptError = await deliverAsPrompt(remote.sessionId, answer);
	ctx.remoteQuestions.delete(questionId);
	sendQuestionResolved(ctx, remote.sessionId, questionId, answer);
	ctx.sendToSelectedPeers(remote.sessionId, {
		type: "status",
		text: promptError
			? `Answer relay failed and the prompt fallback failed: ${promptError}`
			: `Answer delivered as a prompt. ${relayError ?? ""}`.trim(),
	});
	ctx.pushEvent(
		"Question answered",
		promptError
			? "Answer relay failed and the prompt fallback failed"
			: "Answer delivered as a prompt for a session owned by another client",
		promptError ? "warn" : "success",
	);
}
