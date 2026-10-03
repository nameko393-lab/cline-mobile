import { rejectOrphanedApprovals } from "./approvals";
import { resolveOrphanedQuestions } from "./questions";
import type { HubContext } from "./state";

/**
 * How long a session keeps its pending question / approval after the last peer
 * watching it disconnects.
 *
 * A browser reload closes the old socket a moment before the new one attaches,
 * and a phone that drops its connection comes back a few seconds later.
 * Resolving on the peer's behalf the instant the socket closes therefore throws
 * away a question the user can answer a second later — the agent gets the
 * "no client attached" fallback and the card is gone.
 */
export const PEER_DETACH_GRACE_MS = 90_000;

/** Sessions with something parked that a peer would answer. */
function sessionsWithPendingWork(ctx: HubContext): Set<string> {
	const sessionIds = new Set<string>();
	for (const pending of ctx.pendingToolApprovals.values()) {
		sessionIds.add(pending.sessionId);
	}
	for (const pending of ctx.pendingQuestions.values()) {
		sessionIds.add(pending.sessionId);
	}
	for (const remote of ctx.remoteQuestions.values()) {
		sessionIds.add(remote.sessionId);
	}
	return sessionIds;
}

/**
 * Start the grace countdown for every session that lost its last peer. When the
 * grace expires with nobody watching, the parked approvals and questions are
 * answered on the user's behalf; a peer that attaches first cancels it.
 */
export function scheduleOrphanCleanup(
	ctx: HubContext,
	graceMs = PEER_DETACH_GRACE_MS,
): void {
	for (const sessionId of sessionsWithPendingWork(ctx)) {
		if (ctx.hasSelectedPeer(sessionId)) continue;
		if (ctx.peerDetachTimers.has(sessionId)) continue;
		const timer = setTimeout(() => {
			ctx.peerDetachTimers.delete(sessionId);
			if (ctx.hasSelectedPeer(sessionId)) return;
			rejectOrphanedApprovals(ctx);
			resolveOrphanedQuestions(ctx);
		}, graceMs);
		ctx.peerDetachTimers.set(sessionId, timer);
	}
}

/**
 * Cancel the grace countdown because a peer is watching the session again.
 */
export function cancelOrphanCleanup(ctx: HubContext, sessionId: string): void {
	const timer = ctx.peerDetachTimers.get(sessionId);
	if (!timer) return;
	clearTimeout(timer);
	ctx.peerDetachTimers.delete(sessionId);
}
