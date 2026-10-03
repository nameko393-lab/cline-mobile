import type { HubEventEnvelope } from "@cline/shared";
import { describe, expect, it, vi } from "vitest";
import type { HubContext } from "./state";
import type { BrowserPeer } from "./types";

// questions.ts only needs broadcastHubState at runtime; mocking it keeps the
// test from loading @cline/core (state-payloads imports it at module scope).
vi.mock("./state-payloads", () => ({ broadcastHubState: vi.fn() }));

import {
	answerRemoteQuestion,
	handleLocalQuestionResponse,
	observeHubEventForQuestions,
	pendingQuestionRequestsForSession,
	QUESTION_ANSWER_NO_PEER,
	QUESTION_ANSWER_TIMEOUT,
	replayPendingQuestionsForPeer,
	requestQuestionFromWebview,
	resolveAllPendingQuestions,
	resolveOrphanedQuestions,
	resolveQuestion,
	resolveQuestionsForSession,
} from "./questions";

type SentEntry = { peer?: string; payload: Record<string, unknown> };

function makeContext(options: { peerSessions?: string[] } = {}): {
	ctx: HubContext;
	sent: SentEntry[];
	events: Array<{ title: string; body: string }>;
	peers: Set<{ selectedSessionId: string }>;
} {
	const peers = new Set(
		(options.peerSessions ?? ["session-1"]).map((sessionId) => ({
			selectedSessionId: sessionId,
		})),
	);
	const sent: SentEntry[] = [];
	const events: Array<{ title: string; body: string }> = [];
	const ctx = {
		peers,
		sessions: new Map(),
		pendingQuestions: new Map(),
		remoteQuestions: new Map(),
		cline: { getHubClientId: () => "client-owner" },
		uiClient: undefined,
		send: (_peer: unknown, payload: unknown) =>
			sent.push({
				peer: "direct",
				payload: payload as Record<string, unknown>,
			}),
		broadcast: (payload: unknown) =>
			sent.push({ payload: payload as Record<string, unknown> }),
		sendToSelectedPeers(sessionId: string, payload: unknown) {
			if ([...peers].some((peer) => peer.selectedSessionId === sessionId)) {
				sent.push({ payload: payload as Record<string, unknown> });
			}
		},
		hasSelectedPeer(sessionId: string) {
			return [...peers].some((peer) => peer.selectedSessionId === sessionId);
		},
		pushEvent(title: string, body: string) {
			events.push({ title, body });
		},
	} as unknown as HubContext;
	return { ctx, sent, events, peers };
}

function capabilityRequested(
	sessionId: string,
	requestId: string,
	targetClientId: string,
	question: string,
	options: string[],
): HubEventEnvelope {
	return {
		eventId: "hevt_1",
		event: "capability.requested",
		sessionId,
		timestamp: Date.now(),
		payload: {
			requestId,
			capabilityName: "tool_executor.askQuestion",
			targetClientId,
			payload: {
				capabilityName: "tool_executor.askQuestion",
				args: [question, options],
			},
		},
	} as unknown as HubEventEnvelope;
}

describe("requestQuestionFromWebview", () => {
	it("pushes the question with its options to the peers watching the session", async () => {
		const { ctx, sent } = makeContext();

		const answerPromise = requestQuestionFromWebview(ctx, {
			sessionId: "session-1",
			question: "Which theme should the site use?",
			options: ["Dark", "Light"],
		});

		expect(sent).toHaveLength(1);
		expect(sent[0]?.payload).toMatchObject({
			type: "question_request",
			sessionId: "session-1",
			question: "Which theme should the site use?",
			options: ["Dark", "Light"],
		});

		const questionId = String(sent[0]?.payload?.questionId);
		expect(resolveQuestion(ctx, questionId, "Dark")).toBe(true);
		await expect(answerPromise).resolves.toBe("Dark");
		const resolved = sent.filter(
			(entry) => entry.payload.type === "question_resolved",
		);
		expect(resolved).toEqual([
			{ payload: { type: "question_resolved", questionId, answer: "Dark" } },
		]);
	});

	it("answers immediately when no peer is watching the session", async () => {
		const { ctx, sent } = makeContext({ peerSessions: [] });

		await expect(
			requestQuestionFromWebview(ctx, {
				sessionId: "session-1",
				question: "Which theme?",
				options: ["Dark"],
			}),
		).resolves.toBe(QUESTION_ANSWER_NO_PEER);
		expect(sent).toHaveLength(0);
	});

	it("caps the options at five and drops blanks", async () => {
		const { ctx, sent } = makeContext();

		const answerPromise = requestQuestionFromWebview(ctx, {
			sessionId: "session-1",
			question: "Pick one",
			options: ["a", "b", "c", "d", "e", "f", "  "],
		});
		const payload = sent[0]?.payload as { options: string[] };
		expect(payload.options).toEqual(["a", "b", "c", "d", "e"]);

		resolveQuestion(ctx, String(sent[0]?.payload?.questionId), "a");
		await answerPromise;
	});

	it("hands a timeout answer back to the agent", async () => {
		vi.useFakeTimers();
		try {
			const { ctx, sent } = makeContext();
			const answerPromise = requestQuestionFromWebview(ctx, {
				sessionId: "session-1",
				question: "Q?",
				options: ["a"],
			});
			vi.advanceTimersByTime(10 * 60_000 + 1000);
			await expect(answerPromise).resolves.toBe(QUESTION_ANSWER_TIMEOUT);
			expect(ctx.pendingQuestions.size).toBe(0);
			expect(sent[0]?.payload?.type).toBe("question_request");
		} finally {
			vi.useRealTimers();
		}
	});

	describe("resolveQuestion", () => {
		it("returns false for an unknown question id", () => {
			const { ctx } = makeContext();
			expect(resolveQuestion(ctx, "missing", "answer")).toBe(false);
		});

		it("clears every question of a session when the session ends", async () => {
			const { ctx, sent } = makeContext({
				peerSessions: ["session-1", "session-2"],
			});

			const first = requestQuestionFromWebview(ctx, {
				sessionId: "session-1",
				question: "First?",
				options: ["a"],
			});
			requestQuestionFromWebview(ctx, {
				sessionId: "session-2",
				question: "Second?",
				options: ["b"],
			});

			resolveQuestionsForSession(ctx, "session-1", "The session ended.");

			await expect(first).resolves.toBe("The session ended.");
			// The other session's question is untouched.
			expect(ctx.pendingQuestions.size).toBe(1);
			expect(
				sent.filter((entry) => entry.payload.type === "question_resolved"),
			).toHaveLength(1);
		});

		it("resolves everything when the dashboard leaves the hub", async () => {
			const { ctx } = makeContext();
			const first = requestQuestionFromWebview(ctx, {
				sessionId: "session-1",
				question: "First?",
				options: ["a"],
			});
			const second = requestQuestionFromWebview(ctx, {
				sessionId: "session-1",
				question: "Second?",
				options: ["b"],
			});

			resolveAllPendingQuestions(ctx, "Hub detached");

			await expect(first).resolves.toBe("Hub detached");
			await expect(second).resolves.toBe("Hub detached");
			expect(ctx.pendingQuestions.size).toBe(0);
		});

		it("answers a question whose only peer disconnected", async () => {
			const { ctx, peers } = makeContext();

			const answerPromise = requestQuestionFromWebview(ctx, {
				sessionId: "session-1",
				question: "First?",
				options: ["a"],
			});
			peers.clear();

			resolveOrphanedQuestions(ctx);
			await expect(answerPromise).resolves.toBe(QUESTION_ANSWER_NO_PEER);
		});
	});

	describe("handleLocalQuestionResponse", () => {
		it("resolves a pending question owned by this dashboard", async () => {
			const { ctx, sent } = makeContext();
			const answerPromise = requestQuestionFromWebview(ctx, {
				sessionId: "session-1",
				question: "Which theme?",
				options: ["Dark"],
			});
			const questionId = String(sent[0]?.payload?.questionId);

			const handled = handleLocalQuestionResponse(ctx, {
				type: "question_response",
				questionId,
				answer: "Dark",
			});

			expect(handled).toBe(true);
			await expect(answerPromise).resolves.toBe("Dark");
		});

		it("returns false for a mirrored question so the caller relays it", () => {
			const { ctx } = makeContext();
			expect(
				handleLocalQuestionResponse(ctx, {
					type: "question_response",
					questionId: "capreq_1",
					answer: "Dark",
				}),
			).toBe(false);
		});
	});

	describe("observeHubEventForQuestions", () => {
		it("mirrors a follow-up question raised in another client's session", () => {
			const { ctx, sent, events } = makeContext();

			observeHubEventForQuestions(
				ctx,
				capabilityRequested(
					"session-1",
					"capreq_1",
					"client-desktop",
					"Which deploy target?",
					["Staging", "Production"],
				),
			);

			expect(ctx.remoteQuestions.size).toBe(1);
			expect(sent[0]?.payload).toMatchObject({
				type: "question_request",
				questionId: "capreq_1",
				sessionId: "session-1",
				question: "Which deploy target?",
				options: ["Staging", "Production"],
				remote: true,
			});
			expect(events[0]?.title).toBe("Question requested");
		});

		it("ignores its own capability requests, which its executor already raised", () => {
			const { ctx, sent } = makeContext();

			observeHubEventForQuestions(
				ctx,
				capabilityRequested("session-1", "capreq_1", "client-owner", "Q?", [
					"a",
				]),
			);

			expect(ctx.remoteQuestions.size).toBe(0);
			expect(sent).toHaveLength(0);
		});

		it("ignores capabilities that are not follow-up questions", () => {
			const { ctx, sent } = makeContext();

			observeHubEventForQuestions(ctx, {
				event: "capability.requested",
				sessionId: "session-1",
				payload: {
					requestId: "capreq_1",
					capabilityName: "tool_approval.request",
					targetClientId: "client-desktop",
					payload: {},
				},
			} as unknown as HubEventEnvelope);

			expect(ctx.remoteQuestions.size).toBe(0);
			expect(sent).toHaveLength(0);
		});

		it("clears the mirrored question when the owning client answers it", () => {
			const { ctx, sent } = makeContext();
			observeHubEventForQuestions(
				ctx,
				capabilityRequested("session-1", "capreq_1", "client-desktop", "Q?", [
					"a",
				]),
			);

			observeHubEventForQuestions(ctx, {
				event: "capability.resolved",
				sessionId: "session-1",
				payload: { requestId: "capreq_1", ok: true, payload: { result: "a" } },
			} as unknown as HubEventEnvelope);

			expect(ctx.remoteQuestions.size).toBe(0);
			expect(
				sent.filter((entry) => entry.payload.type === "question_resolved"),
			).toHaveLength(1);
		});
	});

	describe("answerRemoteQuestion", () => {
		it("relays the answer to the hub when the hub accepts it", async () => {
			const { ctx, sent } = makeContext();
			ctx.uiClient = {
				sendCommand: vi.fn().mockResolvedValue({ ok: true }),
			} as unknown as HubContext["uiClient"];
			observeHubEventForQuestions(
				ctx,
				capabilityRequested("session-1", "capreq_1", "client-desktop", "Q?", [
					"a",
				]),
			);
			const deliverAsPrompt = vi.fn();

			await answerRemoteQuestion(ctx, "capreq_1", "a", deliverAsPrompt);

			expect(ctx.uiClient?.sendCommand).toHaveBeenCalledWith(
				"capability.respond",
				{ requestId: "capreq_1", ok: true, payload: { result: "a" } },
				"session-1",
			);
			expect(deliverAsPrompt).not.toHaveBeenCalled();
			expect(ctx.remoteQuestions.size).toBe(0);
			expect(
				sent.filter((entry) => entry.payload.type === "question_resolved"),
			).toHaveLength(1);
			expect(
				sent.filter((entry) => entry.payload.type === "status").at(-1)?.payload,
			).toMatchObject({ text: "Answer sent to Cline." });
		});

		it("falls back to a prompt when the hub refuses a non-owner answer", async () => {
			const { ctx, sent } = makeContext();
			ctx.uiClient = {
				sendCommand: vi.fn().mockResolvedValue({
					ok: false,
					error: { message: "capability_wrong_client" },
				}),
			} as unknown as HubContext["uiClient"];
			observeHubEventForQuestions(
				ctx,
				capabilityRequested("session-1", "capreq_1", "client-desktop", "Q?", [
					"a",
				]),
			);
			const deliverAsPrompt = vi.fn().mockResolvedValue(undefined);

			await answerRemoteQuestion(ctx, "capreq_1", "a", deliverAsPrompt);

			expect(deliverAsPrompt).toHaveBeenCalledWith("session-1", "a");
			expect(
				sent.filter((entry) => entry.payload.type === "question_resolved"),
			).toHaveLength(1);
			expect(ctx.remoteQuestions.size).toBe(0);
		});

		it("reports a prompt fallback that also failed", async () => {
			const { ctx, sent } = makeContext();
			ctx.uiClient = {
				sendCommand: vi.fn().mockRejectedValue(new Error("hub down")),
			} as unknown as HubContext["uiClient"];
			observeHubEventForQuestions(
				ctx,
				capabilityRequested("session-1", "capreq_1", "client-desktop", "Q?", [
					"a",
				]),
			);
			const deliverAsPrompt = vi.fn().mockResolvedValue("session not found");

			await answerRemoteQuestion(ctx, "capreq_1", "a", deliverAsPrompt);

			const statuses = sent.filter((entry) => entry.payload.type === "status");
			expect(String(statuses.at(-1)?.payload?.text)).toContain(
				"session not found",
			);
		});

		it("ignores an answer for a question that is no longer pending", async () => {
			const { ctx } = makeContext();
			const deliverAsPrompt = vi.fn();
			await answerRemoteQuestion(ctx, "capreq_gone", "a", deliverAsPrompt);

			expect(deliverAsPrompt).not.toHaveBeenCalled();
		});
	});
});

/**
 * A page that loads after the agent asked (reload, opening the dashboard on the
 * phone later) has no live `question_request` frame, so the options have to come
 * back with the session the peer attaches to.
 */
describe("replayPendingQuestionsForPeer", () => {
	it("re-sends a question this dashboard owns, with its options", async () => {
		const { ctx, sent, peers } = makeContext();
		const answerPromise = requestQuestionFromWebview(ctx, {
			sessionId: "session-1",
			question: "Which theme should the site use?",
			options: ["Dark", "Light"],
		});
		// The reload drops the frames the old peer received.
		sent.length = 0;
		const peer = [...peers][0] as unknown as BrowserPeer;

		expect(replayPendingQuestionsForPeer(ctx, peer, "session-1")).toBe(1);
		expect(sent[0]?.payload).toMatchObject({
			type: "question_request",
			sessionId: "session-1",
			question: "Which theme should the site use?",
			options: ["Dark", "Light"],
		});

		// The replayed id is the live one, so answering it resumes the agent.
		const questionId = String(sent[0]?.payload?.questionId);
		expect(resolveQuestion(ctx, questionId, "Dark")).toBe(true);
		await expect(answerPromise).resolves.toBe("Dark");
	});

	it("re-sends a mirrored question from a session owned by another client", () => {
		const { ctx, sent, peers } = makeContext();
		observeHubEventForQuestions(
			ctx,
			capabilityRequested("session-1", "capreq_1", "client-desktop", "Q?", [
				"a",
				"b",
			]),
		);
		sent.length = 0;
		const peer = [...peers][0] as unknown as BrowserPeer;

		expect(replayPendingQuestionsForPeer(ctx, peer, "session-1")).toBe(1);
		expect(sent[0]?.payload).toMatchObject({
			type: "question_request",
			questionId: "capreq_1",
			sessionId: "session-1",
			question: "Q?",
			options: ["a", "b"],
			remote: true,
		});
	});

	it("replays nothing for a session with no pending question", () => {
		const { ctx, sent, peers } = makeContext();
		observeHubEventForQuestions(
			ctx,
			capabilityRequested("session-1", "capreq_1", "client-desktop", "Q?", []),
		);
		sent.length = 0;
		const peer = [...peers][0] as unknown as BrowserPeer;

		expect(replayPendingQuestionsForPeer(ctx, peer, "session-2")).toBe(0);
		expect(sent).toHaveLength(0);
		expect(pendingQuestionRequestsForSession(ctx, "session-2")).toEqual([]);
	});
});
