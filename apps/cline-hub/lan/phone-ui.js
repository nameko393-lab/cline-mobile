/*
 * Cline Hub LAN — phone UI layer (launcher side, NOT part of Cline)
 *
 * Injected into the built dashboard (dist/webview/index.html) by lan-hub.mjs.
 * It changes only the mobile experience:
 *
 *   1. Enter = newline. Enter never submits; sending goes through the send
 *      button. (Japanese IME composition is left untouched.)
 *   2. A floating 送信 button that submits the composer form, thumb-reachable,
 *      kept above the on-screen keyboard, inside the iOS safe area, and inside
 *      the visible viewport when a wide composer row overflows sideways.
 *   3. Layout tuned for phone screens: 16px inputs (stops the iOS focus zoom),
 *      dvh-based height, safe-area padding so the composer is not hidden under
 *      the keyboard, and 40px minimum tap targets.
 *
 * Nothing runs on a desktop screen, so the PC dashboard keeps Cline's own
 * layout. Plain classic script: no build step, no dependency, and it never
 * touches Cline's source (only the gitignored build output).
 */
(() => {
	"use strict"

	const MARK = "clineLanPhoneUi"
	const CSS_ID = "cline-lan-phone-ui-css"
	const BTN_ID = "cline-lan-phone-ui-send"
	const TOAST_ID = "cline-lan-phone-ui-toast"

	const isPhone = () =>
		window.matchMedia("(pointer: coarse)").matches ||
		window.matchMedia("(max-width: 820px)").matches

	const log = (...args) => console.info("[cline-lan-phone-ui]", ...args)

	/** iOS safe-area insets need viewport-fit=cover on the viewport meta. */
	function ensureViewportFit() {
		const meta = document.querySelector('meta[name="viewport"]')
		if (!meta) return
		const content = meta.getAttribute("content") || ""
		if (!content.includes("viewport-fit")) {
			meta.setAttribute("content", [content, "viewport-fit=cover"].filter(Boolean).join(","))
		}
	}

	function ensureStyle() {
		if (document.getElementById(CSS_ID)) return
		const style = document.createElement("style")
		style.id = CSS_ID
		style.textContent = `
			:root { --cline-lan-kbd: 0px; --cline-lan-kbd-x: 0px; }
			/* 16px keeps iOS Safari from zooming the page when a field is focused. */
			textarea, input, select { font-size: 16px !important; }
			html, body { height: 100%; overflow-x: hidden; }
			#root { min-height: 100dvh; }
			button, [role="button"] { min-height: 40px; }
			/* Room at the bottom: the floating send button lives there. */
			form:has(textarea) { padding-bottom: 68px !important; }
			/* The composer footer must wrap: a wide row would push the send
			 * button past the right edge on a narrow portrait screen. */
			form:has(textarea) div:has(> button[type="submit"]) { flex-wrap: wrap !important; }
			#${BTN_ID} {
				position: fixed;
				right: calc(max(12px, env(safe-area-inset-right, 0px)) + var(--cline-lan-kbd-x, 0px));
				bottom: calc(env(safe-area-inset-bottom, 0px) + 12px + var(--cline-lan-kbd));
				z-index: 2147483000;
				min-width: 72px;
				min-height: 48px;
				padding: 0 18px;
				border: 0;
				border-radius: 14px;
				font-size: 16px;
				font-weight: 600;
				line-height: 1;
				color: #fff;
				background: #1d4ed8;
				box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
				touch-action: manipulation;
			}
			#${BTN_ID}:disabled { opacity: 0.45; }
			#${BTN_ID}[data-generating="1"] { background: #b91c1c; }
		`
		document.head.appendChild(style)
	}

	/**
	 * How far the on-screen keyboard and the sideways overflow cover the layout.
	 * visualViewport.height shrinks when the keyboard opens, and
	 * visualViewport.width is narrower than the layout viewport whenever a wide
	 * row overflows sideways. A fixed element is placed against the layout
	 * viewport, so on a phone it would sit past the visible edge and become
	 * unpressable. Both gaps are published as CSS variables and added to the
	 * send button's offsets.
	 */
	function trackViewport() {
		const vv = window.visualViewport
		const sync = () => {
			const gapY = Math.max(0, Math.round(window.innerHeight - (vv ? vv.height : window.innerHeight)))
			const gapX = Math.max(0, Math.round(window.innerWidth - (vv ? vv.width : window.innerWidth)))
			document.documentElement.style.setProperty("--cline-lan-kbd", `${gapY}px`)
			document.documentElement.style.setProperty("--cline-lan-kbd-x", `${gapX}px`)
		}
		sync()
		if (!vv) return
		vv.addEventListener("resize", sync)
		vv.addEventListener("scroll", sync)
	}

	const findForm = () => {
		const textarea = document.querySelector("form textarea")
		return textarea ? { textarea, form: textarea.closest("form") } : null
	}

	const findSubmit = (form) =>
		form?.querySelector('button[type="submit"]') ??
		form?.querySelector('button[aria-label="Submit"], button[aria-label="Stop"]') ??
		null

	/** Insert a newline at the caret in a way React's onChange picks up. */
	function insertNewline(textarea) {
		const start = textarea.selectionStart ?? textarea.value.length
		const end = textarea.selectionEnd ?? textarea.value.length
		textarea.focus()
		// execCommand fires a real input event, so React state stays in sync.
		try {
			if (document.execCommand("insertText", false, "\n")) return
		} catch {}
		const next = `${textarea.value.slice(0, start)}\n${textarea.value.slice(end)}`
		const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
		if (setter) setter.call(textarea, next)
		else textarea.value = next
		textarea.selectionStart = textarea.selectionEnd = start + 1
		textarea.dispatchEvent(new Event("input", { bubbles: true }))
	}

	/**
	 * Enter -> newline. Registered in the capture phase on the textarea itself:
	 * React attaches its key handler on the root container, so stopping
	 * propagation here means the dashboard's own "Enter submits" handler never
	 * runs. Shift+Enter and IME composition are left to the browser.
	 */
	function onKeydown(event) {
		if (event.key !== "Enter" || event.shiftKey) return
		if (event.isComposing || event.nativeEvent?.isComposing) return
		event.preventDefault()
		event.stopPropagation()
		insertNewline(event.currentTarget)
	}

	function ensureComposer() {
		const found = findForm()
		if (!found) return
		const { textarea, form } = found
		if (!textarea.dataset[MARK]) {
			textarea.dataset[MARK] = "1"
			textarea.addEventListener("keydown", onKeydown, true)
			log("Enter is now newline; use the send button to submit")
		}

		let button = document.getElementById(BTN_ID)
		if (!button) {
			button = document.createElement("button")
			button.id = BTN_ID
			button.type = "button"
			document.body.appendChild(button)
		}
		const submit = findSubmit(form)
		const generating = submit?.getAttribute("aria-label") === "Stop"
		button.dataset.generating = generating ? "1" : "0"
		button.textContent = generating ? "停止" : "送信"
		button.setAttribute("aria-label", generating ? "Stop" : "Send")
		button.disabled = !submit || submit.disabled
		button.onclick = () => {
			const current = findSubmit(form)
			if (!current || current.disabled) return
			current.click()
		}
	}

	/* ------------------------- session not found recovery ------------------- */
	/*
	 * Stock dashboard behaviour: selecting a session only hydrates its history
	 * from disk; the hub only accepts a turn for sessions it holds in memory. A
	 * session created in Cline Desktop (or an older one) is therefore listed in
	 * the dashboard, but sending to it answers "session not found: <id>".
	 *
	 * The dashboard's createSession() resolves its launch context from the
	 * config the browser sends, and that resolution honours workspaceRoot / cwd
	 * / provider / model. So the mediator below, sitting on the app's
	 * WebSocket, recovers by creating a fresh session in the SAME folder as the
	 * session that failed, with the same provider and model, and resends the
	 * prompt. Mediation only: no Cline code is changed.
	 */
	const SESSION_NOT_FOUND = /session not found/i
	/*
	 * session.restore takes the checkpoint at or before checkpointRunCount
	 * (checkpoint-diff.ts), so a large sentinel means "the latest checkpoint".
	 */
	const LATEST_CHECKPOINT = 1000000

	/** Options ride on the injected tag's query string (set by start.cmd). */
	function readLayerOptions() {
		const src = (document.currentScript && document.currentScript.src) || ""
		return {
			restore: !/[?&]restore=0/.test(src),
			restoreTimeoutMs: (() => {
				const match = /[?&]restoreTimeout=(\d+)/.exec(src)
				const parsed = match ? Number.parseInt(match[1], 10) : NaN
				return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000
			})(),
		}
	}
	const layerOptions = readLayerOptions()

	function parseFrame(data) {
		if (typeof data !== "string") return null
		try {
			const frame = JSON.parse(data)
			return frame && typeof frame === "object" ? frame : null
		} catch {
			return null
		}
	}

	function toast(text) {
		let box = document.getElementById(TOAST_ID)
		if (!box) {
			box = document.createElement("div")
			box.id = TOAST_ID
			document.body.appendChild(box)
		}
		box.textContent = text
		box.dataset.visible = "1"
		clearTimeout(box.timer)
		box.timer = setTimeout(() => {
			box.dataset.visible = "0"
		}, 8000)
	}

	/** Remember what the app is doing on this socket. */
	function trackOutgoing(socket, data) {
		const frame = parseFrame(data)
		if (!frame) return
		const state = socket.__clineLan
		if (frame.type === "send") {
			state.last = { prompt: frame.prompt, config: frame.config, attachments: frame.attachments }
			state.recovering = false
		}
		if (frame.type === "attachSession" && typeof frame.sessionId === "string") {
			state.selected = frame.sessionId
		}
	}

	function handleIncoming(socket, data) {
		const frame = parseFrame(data)
		if (!frame) return
		const state = socket.__clineLan

		if (frame.type === "sessions" && Array.isArray(frame.sessions)) {
			state.sessions = new Map(
				frame.sessions
					.filter((session) => session && typeof session.sessionId === "string")
					.map((session) => [session.sessionId, session]),
			)
			return
		}
		if (frame.type === "session_started" && typeof frame.sessionId === "string") {
			state.selected = frame.sessionId
			if (state.awaiting) flushAwaiting(socket, frame.sessionId)
			return
		}
		if (frame.type === "reset_done") {
			state.selected = null
			clearAwaiting(socket)
			return
		}
		if (frame.type === "error" && typeof frame.text === "string") {
			if (state.awaiting) {
				failRestore(socket, frame.text)
				return
			}
			if (SESSION_NOT_FOUND.test(frame.text)) recoverSend(socket, frame.text)
		}
	}

	function directSend(socket, frame) {
		const native = socket.constructor.__clineLanNativeSend
		const payload = JSON.stringify(frame)
		if (native) native.call(socket, payload)
		else socket.send(payload)
	}

	function clearAwaiting(socket) {
		const state = socket.__clineLan
		if (state.timer) clearTimeout(state.timer)
		state.awaiting = null
		state.timer = null
	}

	/** No checkpoint to restore: create a fresh session in the same folder. */
	function fallbackCreate(socket, last, target) {
		socket.__clineLan.recovering = true
		if (!target || !target.workspaceRoot) {
			toast("このセッションは hub がメモリに持っていません。新規セッションとして送り直してください。")
			return
		}
		directSend(socket, { type: "reset" })
		directSend(socket, {
			type: "send",
			prompt: last.prompt,
			config: {
				...(last.config ?? {}),
				workspaceRoot: target.workspaceRoot,
				cwd: target.cwd ?? target.workspaceRoot,
				provider: target.providerId ?? last.config?.provider,
				model: target.modelId ?? last.config?.model,
			},
			attachments: last.attachments,
		})
		toast(`チェックポイントが無いため同じフォルダで新セッションを作り、送信し直しました ${target.workspaceRoot}`)
	}

	function flushAwaiting(socket, sessionId) {
		const state = socket.__clineLan
		const awaiting = state.awaiting
		clearAwaiting(socket)
		if (!awaiting) return
		const restored = state.sessions.get(sessionId)
		directSend(socket, {
			type: "send",
			prompt: awaiting.prompt,
			config: {
				...(awaiting.config ?? {}),
				provider: restored?.providerId ?? awaiting.config?.provider,
				model: restored?.modelId ?? awaiting.config?.model,
			},
			attachments: awaiting.attachments,
		})
		toast("セッションを hub に読み込み、会話を継いで送信しました")
		console.info("[cline-lan-phone-ui] restored session is live:", sessionId)
	}

	function failRestore(socket, errorText) {
		const state = socket.__clineLan
		const awaiting = state.awaiting
		clearAwaiting(socket)
		if (!awaiting) return
		console.warn("[cline-lan-phone-ui] restore failed:", errorText)
		fallbackCreate(socket, awaiting, awaiting.target)
	}

	function recoverSend(socket, errorText) {
		const state = socket.__clineLan
		const last = state.last
		if (!last || state.recovering) return
		state.last = null
		const target = state.selected ? state.sessions.get(state.selected) : null

		if (layerOptions.restore && state.selected) {
			state.recovering = true
			state.awaiting = {
				prompt: last.prompt,
				config: last.config,
				attachments: last.attachments,
				target,
			}
			directSend(socket, { type: "restore", checkpointRunCount: LATEST_CHECKPOINT })
			state.timer = setTimeout(() => failRestore(socket, "restore timed out"), layerOptions.restoreTimeoutMs)
			toast("セッションを hub に読み込み直しています…")
			console.info("[cline-lan-phone-ui]", errorText, "-> asking the dashboard to restore", state.selected)
			return
		}
		fallbackCreate(socket, last, target)
	}

	function installSessionRecovery() {
		const Native = window.WebSocket
		if (typeof Native !== "function" || Native.__clineLanPhoneUi) return

		class MediatedSocket extends Native {
			constructor(...args) {
				super(...args)
				this.__clineLan = {
					sessions: new Map(),
					selected: null,
					last: null,
					recovering: false,
					awaiting: null,
					timer: null,
				}
				this.addEventListener("message", (event) => handleIncoming(this, event.data))
			}
		}
		MediatedSocket.__clineLanPhoneUi = true

		const nativeSend = Native.prototype.send
		MediatedSocket.__clineLanNativeSend = nativeSend
		MediatedSocket.prototype.send = function (data) {
			trackOutgoing(this, data)
			return nativeSend.call(this, data)
		}

		window.WebSocket = MediatedSocket
	}

	function ensureToastStyle() {
		if (document.getElementById("cline-lan-phone-ui-toast-css")) return
		const style = document.createElement("style")
		style.id = "cline-lan-phone-ui-toast-css"
		style.textContent = `
			#${TOAST_ID} {
				position: fixed;
				left: 50%;
				top: calc(env(safe-area-inset-top, 0px) + 10px);
				transform: translateX(-50%);
				max-width: 92vw;
				padding: 10px 14px;
				border-radius: 12px;
				background: rgba(17, 24, 39, 0.95);
				color: #fff;
				font-size: 14px;
				line-height: 1.45;
				text-align: left;
				white-space: normal;
				word-break: break-word;
				z-index: 2147483001;
				display: none;
			}
			#${TOAST_ID}[data-visible="1"] { display: block; }
		`
		document.head.appendChild(style)
	}

	function boot() {
		installSessionRecovery()
		ensureToastStyle()
		if (!isPhone()) return
		ensureViewportFit()
		ensureStyle()
		trackViewport()
		ensureComposer()

		let queued = false
		const refresh = () => {
			if (queued) return
			queued = true
			requestAnimationFrame(() => {
				queued = false
				ensureComposer()
			})
		}
		new MutationObserver(refresh).observe(document.body, { childList: true, subtree: true })
		setInterval(refresh, 1000)
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot)
	} else {
		boot()
	}
})()

