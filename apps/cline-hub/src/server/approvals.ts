import type { ToolApprovalRequest, ToolApprovalResult } from "@cline/shared";
import type { WebviewInboundMessage } from "../webview-protocol";
import type { HubContext } from "./state";
import { broadcastHubState } from "./state-payloads";
import type { BrowserPeer } from "./types";

function createApprovalId(): string {
	return `approval-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function resolveToolApproval(
	ctx: HubContext,
	approvalId: string,
	result: ToolApprovalResult,
): boolean {
	const pending = ctx.pendingToolApprovals.get(approvalId);
	if (!pending) return false;
	clearTimeout(pending.timeout);
	ctx.pendingToolApprovals.delete(approvalId);
	ctx.sendToSelectedPeers(pending.sessionId, {
		type: "approval_resolved",
		approvalId,
		approved: result.approved,
		reason: result.reason,
	});
	pending.resolve(result);
	return true;
}

export function rejectPendingApprovalsForSession(
	ctx: HubContext,
	sessionId: string,
	reason: string,
): void {
	for (const [approvalId, pending] of [...ctx.pendingToolApprovals.entries()]) {
		if (pending.sessionId === sessionId) {
			resolveToolApproval(ctx, approvalId, { approved: false, reason });
		}
	}
}

export function rejectAllPendingApprovals(
	ctx: HubContext,
	reason: string,
): void {
	for (const approvalId of [...ctx.pendingToolApprovals.keys()]) {
		resolveToolApproval(ctx, approvalId, { approved: false, reason });
	}
}

export function rejectOrphanedApprovals(ctx: HubContext): void {
	for (const [approvalId, pending] of [...ctx.pendingToolApprovals.entries()]) {
		if (!ctx.hasSelectedPeer(pending.sessionId)) {
			resolveToolApproval(ctx, approvalId, {
				approved: false,
				reason: "Cline Hub webview disconnected before approval was resolved.",
			});
		}
	}
}

export function requestToolApprovalFromWebview(
	ctx: HubContext,
	request: ToolApprovalRequest,
): Promise<ToolApprovalResult> {
	if (!ctx.hasSelectedPeer(request.sessionId)) {
		return Promise.resolve({
			approved: false,
			reason: "No Cline Hub webview is attached to this session.",
		});
	}

	const approvalId = createApprovalId();
	ctx.pushEvent(
		"Tool approval requested",
		`${request.toolName} is waiting for approval`,
		"warn",
	);
	broadcastHubState(ctx);

	return new Promise((resolve) => {
		const timeout = setTimeout(() => {
			resolveToolApproval(ctx, approvalId, {
				approved: false,
				reason: "Tool approval request timed out.",
			});
		}, 10 * 60_000);
		ctx.pendingToolApprovals.set(approvalId, {
			sessionId: request.sessionId,
			request,
			createdAt: Date.now(),
			resolve,
			timeout,
		});
		ctx.sendToSelectedPeers(request.sessionId, {
			type: "approval_request",
			approvalId,
			sessionId: request.sessionId,
			agentId: request.agentId,
			conversationId: request.conversationId,
			iteration: request.iteration,
			toolCallId: request.toolCallId,
			toolName: request.toolName,
			input: request.input,
			policy: request.policy as Record<string, unknown> | undefined,
		});
	});
}

export function handleToolApprovalResponse(
	ctx: HubContext,
	frame: Extract<WebviewInboundMessage, { type: "approval_response" }>,
): void {
	const approvalId = frame.approvalId.trim();
	if (!approvalId) return;
	const resolved = resolveToolApproval(ctx, approvalId, {
		approved: frame.approved,
		reason:
			frame.reason ??
			(frame.approved ? "Approved in Cline Hub." : "Rejected in Cline Hub."),
	});
	if (!resolved) {
		console.warn(`Ignoring unknown tool approval response: ${approvalId}`);
	}
}

/**
 * Re-send the approvals a session is parked on to a peer that just attached.
 *
 * Same reason as the questions: the card is built from the `approval_request`
 * frame alone, so a page that loads after the agent asked for approval shows
 * nothing while the turn sits parked.
 */
export function replayPendingApprovalsForPeer(
	ctx: HubContext,
	peer: BrowserPeer,
	sessionId: string,
): number {
	let sent = 0;
	for (const [approvalId, pending] of ctx.pendingToolApprovals) {
		if (pending.sessionId !== sessionId) continue;
		ctx.send(peer, {
			type: "approval_request",
			approvalId,
			...pending.request,
		});
		sent += 1;
	}
	return sent;
}
