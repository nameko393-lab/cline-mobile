import type {
	WebviewChatAttachments,
	WebviewConfig,
	WebviewInboundMessage,
	WebviewOutboundMessage,
	WebviewSessionSummary,
} from "../../../webview-protocol";

/**
 * Session-not-found recovery for the hub dashboard.
 *
 * Stock dashboard behaviour: selecting a session only hydrates its history from
 * disk, while the hub only accepts a turn for sessions it holds in memory. A
 * session created in Cline Desktop (or an older one) is therefore listed in the
 * dashboard, but sending to it answers `session not found: <id>`.
 *
 * The dashboard's createSession() resolves its launch context from the config the
 * browser sends, and that resolution honours workspaceRoot / cwd / provider /
 * model. So recovery can be done entirely from the peer side:
 *
 *   1. ask the hub to load the latest checkpoint of the selected session
 *      (`{ type: "restore", checkpointRunCount }`), then resend the prompt on
 *      the session that comes back, keeping provider / model / mode;
 *   2. when there is no checkpoint to restore, create a fresh session in the
 *      SAME folder with the same provider and model, and resend the prompt.
 *
 * The module is DOM-free on purpose: it only moves protocol frames, so it is
 * testable without a browser and it works on every layout, not just phones.
 */

const SESSION_NOT_FOUND = /session not found/i;

/**
 * `session.restore` takes the checkpoint at or before `checkpointRunCount`, so a
 * large sentinel means "the latest checkpoint".
 */
export const LATEST_CHECKPOINT = 1_000_000;

export const DEFAULT_RESTORE_TIMEOUT_MS = 20_000;

export type SessionRecoveryOptions = {
	/** Ask for a checkpoint restore before falling back to a new session. */
	restore?: boolean;
	/** How long to wait for the restored session before falling back. */
	restoreTimeoutMs?: number;
	/** Surface a short human note (the webview shows these as toasts). */
	onToast?: (text: string) => void;
	/** Mirror what recovery decided, for the console. */
	onLog?: (level: "info" | "warn", text: string) => void;
};

type SentPrompt = {
	prompt: string;
	config?: WebviewConfig;
	attachments?: WebviewChatAttachments;
};

type PendingRestore = SentPrompt & { target?: WebviewSessionSummary };

export type SessionRecoveryState = {
	/** Every session the dashboard listed, keyed by id. */
	sessions: Map<string, WebviewSessionSummary>;
	/** The session the peer is talking to. */
	selected: string | null;
	/** The prompt the peer last tried to send. */
	last: SentPrompt | null;
	/** A recovery is already running for `last`. */
	recovering: boolean;
	/** We are waiting for the restored session to start. */
	awaiting: PendingRestore | null;
	timer: ReturnType<typeof setTimeout> | null;
};

export type SessionRecovery = {
	state: SessionRecoveryState;
	/** Observe a frame the peer is about to send. */
	handleOutgoing: (message: WebviewInboundMessage) => void;
	/** Observe a frame the dashboard sent, and recover when it failed. */
	handleIncoming: (message: WebviewOutboundMessage) => void;
};

export function createSessionRecovery(
	post: (message: WebviewInboundMessage) => void,
	options: SessionRecoveryOptions = {},
): SessionRecovery {
	const restoreEnabled = options.restore !== false;
	const restoreTimeoutMs =
		typeof options.restoreTimeoutMs === "number" && options.restoreTimeoutMs > 0
			? options.restoreTimeoutMs
			: DEFAULT_RESTORE_TIMEOUT_MS;

	const state: SessionRecoveryState = {
		sessions: new Map(),
		selected: null,
		last: null,
		recovering: false,
		awaiting: null,
		timer: null,
	};

	const toast = (text: string) => options.onToast?.(text);
	const log = (level: "info" | "warn", text: string) =>
		options.onLog?.(level, text);

	function clearAwaiting(): void {
		if (state.timer) clearTimeout(state.timer);
		state.awaiting = null;
		state.timer = null;
	}

	/** No checkpoint to restore: create a fresh session in the same folder. */
	function fallbackCreate(
		target: WebviewSessionSummary | undefined,
		last: SentPrompt | null,
	): void {
		state.recovering = true;
		if (!last || !target?.workspaceRoot) {
			toast(
				"このセッションは hub がメモリに持っていません。新規セッションとして送り直してください。",
			);
			return;
		}
		post({ type: "reset" });
		post({
			type: "send",
			prompt: last.prompt,
			config: {
				...(last.config ?? {}),
				workspaceRoot: target.workspaceRoot,
				cwd: target.workspaceRoot,
				provider: target.providerId ?? last.config?.provider,
				model: target.model ?? last.config?.model,
			},
			attachments: last.attachments,
		});
		toast(
			`チェックポイントが無いため同じフォルダで新セッションを作り、送信し直しました ${target.workspaceRoot}`,
		);
	}

	/** The restored session is live: continue the conversation in it. */
	function flushAwaiting(sessionId: string): void {
		const awaiting = state.awaiting;
		clearAwaiting();
		if (!awaiting) return;
		const restored = state.sessions.get(sessionId);
		post({
			type: "send",
			prompt: awaiting.prompt,
			config: {
				...(awaiting.config ?? {}),
				provider: restored?.providerId ?? awaiting.config?.provider,
				model: restored?.model ?? awaiting.config?.model,
			},
			attachments: awaiting.attachments,
		});
		toast("セッションを hub に読み込み、会話を継いで送信しました");
		log("info", `restored session is live: ${sessionId}`);
	}

	function failRestore(errorText: string): void {
		const awaiting = state.awaiting;
		clearAwaiting();
		if (!awaiting) return;
		log("warn", `restore failed: ${errorText}`);
		fallbackCreate(awaiting.target, awaiting);
	}

	function recoverSend(errorText: string): void {
		const last = state.last;
		if (!last || state.recovering) return;
		state.last = null;
		const target = state.selected
			? state.sessions.get(state.selected)
			: undefined;

		if (restoreEnabled && state.selected) {
			state.recovering = true;
			state.awaiting = {
				prompt: last.prompt,
				config: last.config,
				attachments: last.attachments,
				target,
			};
			post({ type: "restore", checkpointRunCount: LATEST_CHECKPOINT });
			state.timer = setTimeout(
				() => failRestore("restore timed out"),
				restoreTimeoutMs,
			);
			toast("セッションを hub に読み込み直しています…");
			log(
				"info",
				`${errorText} -> asking the dashboard to restore ${state.selected}`,
			);
			return;
		}
		fallbackCreate(target, last);
	}

	function handleOutgoing(message: WebviewInboundMessage): void {
		if (message.type === "send") {
			state.last = {
				prompt: message.prompt,
				config: message.config,
				attachments: message.attachments,
			};
			state.recovering = false;
			return;
		}
		if (message.type === "attachSession") {
			state.selected = message.sessionId;
		}
	}

	function handleIncoming(message: WebviewOutboundMessage): void {
		if (message.type === "sessions") {
			state.sessions = new Map(
				message.sessions
					.filter((session) => typeof session.sessionId === "string")
					.map((session) => [session.sessionId, session]),
			);
			return;
		}
		if (message.type === "session_started") {
			state.selected = message.sessionId;
			if (state.awaiting) flushAwaiting(message.sessionId);
			return;
		}
		if (message.type === "reset_done") {
			state.selected = null;
			clearAwaiting();
			return;
		}
		if (message.type === "error") {
			if (state.awaiting) {
				failRestore(message.text);
				return;
			}
			if (SESSION_NOT_FOUND.test(message.text)) recoverSend(message.text);
		}
	}

	return { state, handleOutgoing, handleIncoming };
}
