import { describe, expect, it, vi } from "vitest";
import {
	cancelOrphanCleanup,
	PEER_DETACH_GRACE_MS,
	scheduleOrphanCleanup,
} from "./orphans";
import { QUESTION_ANSWER_NO_PEER } from "./questions";
import { HubContext } from "./state";
import type { BrowserPeer } from "./types";

/**
 * A browser reload closes the old socket a moment before the new one attaches.
 * Answering the pending question on the peer's behalf the instant the socket
 * closes would therefore resolve it on every refresh, so the disconnect gets a
 * grace window that a re-attach cancels.
 */

function makeContext(options: { peerSessionId?: string } = {}): HubContext {
	const ctx = new HubContext();
	if (options.peerSessionId) {
		ctx.peers.add({
			displayName: "phone",
			sending: false,
			selectedSessionId: options.peerSessionId,
			socket: { send: () => {} },
		} as unknown as BrowserPeer);
	}
	return ctx;
}

function parkQuestion(ctx: HubContext, sessionId: string) {
	const resolve = vi.fn();
	const timeout = setTimeout(() => {}, 600_000);
	ctx.pendingQuestions.set("question-1", {
		questionId: "question-1",
		sessionId,
		question: "どのテーマにしますか？",
		options: ["Dark", "Light"],
		createdAt: Date.now(),
		resolve,
		timeout,
	});
	return resolve;
}

describe("scheduleOrphanCleanup", () => {
	it("leaves a session a peer is still watching alone", () => {
		vi.useFakeTimers();
		const ctx = makeContext({ peerSessionId: "session-1" });
		const resolve = parkQuestion(ctx, "session-1");

		scheduleOrphanCleanup(ctx);

		expect(ctx.peerDetachTimers.size).toBe(0);
		expect(resolve).not.toHaveBeenCalled();
		vi.clearAllTimers();
		vi.useRealTimers();
	});

	it("keeps the question through the grace window and resolves it after", () => {
		vi.useFakeTimers();
		const ctx = makeContext();
		const resolve = parkQuestion(ctx, "session-1");

		scheduleOrphanCleanup(ctx);
		expect(ctx.peerDetachTimers.has("session-1")).toBe(true);
		expect(resolve).not.toHaveBeenCalled();

		vi.advanceTimersByTime(PEER_DETACH_GRACE_MS - 1);
		expect(resolve).not.toHaveBeenCalled();

		vi.advanceTimersByTime(1);
		expect(resolve).toHaveBeenCalledWith(QUESTION_ANSWER_NO_PEER);
		expect(ctx.pendingQuestions.size).toBe(0);
		expect(ctx.peerDetachTimers.size).toBe(0);
		vi.useRealTimers();
	});

	it("drops the resolution when a peer attaches within the grace window", () => {
		vi.useFakeTimers();
		const ctx = makeContext();
		const resolve = parkQuestion(ctx, "session-1");

		scheduleOrphanCleanup(ctx);
		cancelOrphanCleanup(ctx, "session-1");
		expect(ctx.peerDetachTimers.size).toBe(0);

		vi.advanceTimersByTime(PEER_DETACH_GRACE_MS + 1_000);
		expect(resolve).not.toHaveBeenCalled();
		expect(ctx.pendingQuestions.size).toBe(1);
		vi.useRealTimers();
	});

	it("does not stack a second countdown for the same session", () => {
		vi.useFakeTimers();
		const ctx = makeContext();
		parkQuestion(ctx, "session-1");

		scheduleOrphanCleanup(ctx);
		scheduleOrphanCleanup(ctx);

		expect(ctx.peerDetachTimers.size).toBe(1);
		vi.clearAllTimers();
		vi.useRealTimers();
	});
});
