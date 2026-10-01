import { afterEach, describe, expect, it, vi } from "vitest";
import type {
	WebviewInboundMessage,
	WebviewSessionSummary,
} from "../../../webview-protocol";
import { createSessionRecovery, LATEST_CHECKPOINT } from "./session-recovery";

function setup(options: Parameters<typeof createSessionRecovery>[1] = {}) {
	const posted: WebviewInboundMessage[] = [];
	const toasts: string[] = [];
	const recovery = createSessionRecovery((message) => posted.push(message), {
		onToast: (text) => toasts.push(text),
		...options,
	});
	return { recovery, posted, toasts };
}

function session(
	overrides: Partial<WebviewSessionSummary> = {},
): WebviewSessionSummary {
	return {
		sessionId: "session_A",
		workspaceRoot: "/work/a",
		providerId: "openrouter",
		model: "gpt-5",
		...overrides,
	};
}

/** A desktop session the hub no longer holds: the prompt comes back as an error. */
function sendToForgottenSession(
	recovery: ReturnType<typeof createSessionRecovery>,
	options: { attach?: boolean } = {},
) {
	recovery.handleIncoming({ type: "sessions", sessions: [session()] });
	if (options.attach !== false) {
		recovery.handleOutgoing({ type: "attachSession", sessionId: "session_A" });
	}
	recovery.handleOutgoing({
		type: "send",
		prompt: "hello",
		config: { provider: "openrouter", model: "gpt-5", mode: "act" },
	});
	recovery.handleIncoming({
		type: "error",
		text: "session not found: session_A",
	});
}

function sendsOf(posted: WebviewInboundMessage[]) {
	return posted.filter((message) => message.type === "send");
}

afterEach(() => {
	vi.useRealTimers();
});

describe("session recovery", () => {
	it("asks the dashboard to restore the latest checkpoint", () => {
		const { recovery, posted } = setup();
		sendToForgottenSession(recovery);
		expect(posted).toHaveLength(1);
		expect(posted[0]).toEqual({
			type: "restore",
			checkpointRunCount: LATEST_CHECKPOINT,
		});
	});

	it("continues in the restored session with its provider and model", () => {
		const { recovery, posted } = setup();
		sendToForgottenSession(recovery);
		recovery.handleIncoming({
			type: "sessions",
			sessions: [
				session(),
				session({
					sessionId: "session_R",
					providerId: "anthropic",
					model: "claude",
				}),
			],
		});
		recovery.handleIncoming({
			type: "session_started",
			sessionId: "session_R",
		});
		const sends = sendsOf(posted);
		expect(sends).toHaveLength(1);
		expect(sends[0]?.prompt).toBe("hello");
		expect(sends[0]?.config?.provider).toBe("anthropic");
		expect(sends[0]?.config?.model).toBe("claude");
	});

	it("keeps the mode and does not override the workspace when continuing", () => {
		const { recovery, posted, toasts } = setup();
		sendToForgottenSession(recovery);
		recovery.handleIncoming({
			type: "session_started",
			sessionId: "session_R",
		});
		const send = sendsOf(posted)[0];
		expect(send?.config?.mode).toBe("act");
		expect(send?.config?.workspaceRoot).toBeUndefined();
		expect(toasts.at(-1)).toContain("会話を継いで送信");
	});

	it("recovers once per prompt", () => {
		const { recovery, posted } = setup();
		sendToForgottenSession(recovery);
		recovery.handleIncoming({
			type: "error",
			text: "session not found: session_A",
		});
		expect(posted.filter((message) => message.type === "restore")).toHaveLength(
			1,
		);
	});

	it("leaves a healthy send untouched", () => {
		const { recovery, posted } = setup();
		recovery.handleOutgoing({ type: "send", prompt: "hello" });
		recovery.handleIncoming({ type: "status", text: "connected" });
		expect(posted).toHaveLength(0);
	});

	it("does not restore a session the peer never selected", () => {
		const { recovery, posted, toasts } = setup();
		sendToForgottenSession(recovery, { attach: false });
		expect(posted.filter((message) => message.type === "restore")).toHaveLength(
			0,
		);
		expect(toasts.at(-1)).toContain("新規セッション");
	});

	it("falls back to the same folder when there is no checkpoint", () => {
		const { recovery, posted } = setup();
		sendToForgottenSession(recovery);
		recovery.handleIncoming({
			type: "error",
			text: "No checkpoint found at or before run 1000000 in session session_A",
		});
		expect(posted[1]).toEqual({ type: "reset" });
		const send = sendsOf(posted)[0];
		expect(send?.config?.workspaceRoot).toBe("/work/a");
		expect(send?.config?.cwd).toBe("/work/a");
		expect(send?.config?.provider).toBe("openrouter");
	});

	it("never asks for a checkpoint restore when restore is off", () => {
		const { recovery, posted } = setup({ restore: false });
		sendToForgottenSession(recovery);
		expect(posted.filter((message) => message.type === "restore")).toHaveLength(
			0,
		);
		expect(posted[0]).toEqual({ type: "reset" });
		expect(sendsOf(posted)[0]?.config?.workspaceRoot).toBe("/work/a");
	});

	it("falls back to the same folder when the restore times out", () => {
		vi.useFakeTimers();
		const { recovery, posted } = setup({ restoreTimeoutMs: 1000 });
		sendToForgottenSession(recovery);
		vi.advanceTimersByTime(1000);
		expect(posted[1]).toEqual({ type: "reset" });
		expect(sendsOf(posted)[0]?.config?.workspaceRoot).toBe("/work/a");
	});

	it("clears the selection and any pending restore on reset_done", () => {
		const { recovery, posted } = setup();
		sendToForgottenSession(recovery);
		recovery.handleIncoming({ type: "reset_done" });
		expect(recovery.state.selected).toBeNull();
		expect(recovery.state.awaiting).toBeNull();
		recovery.handleIncoming({
			type: "session_started",
			sessionId: "session_R",
		});
		expect(sendsOf(posted)).toHaveLength(0);
	});
});
