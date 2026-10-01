/*
 * phone-ui.js behaviour test (no browser needed): bun phone-ui.test.mjs
 *
 * Runs the injected script against a minimal fake DOM and asserts the three
 * things the phone needs:
 *   - Enter inserts a newline and never submits
 *   - Shift+Enter is left to the browser
 *   - the floating send button drives the real submit button
 */
import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

let failures = 0
const check = (label, ok) => {
	console.log(`${ok ? "ok  " : "FAIL"} ${label}`)
	if (!ok) failures++
}

class FakeEvent {
	constructor(type, init = {}) {
		this.type = type
		this.target = null
		this.currentTarget = null
		this.defaultPrevented = false
		this.propagationStopped = false
		this.isComposing = false
		Object.assign(this, init)
	}
	preventDefault() {
		this.defaultPrevented = true
	}
	stopPropagation() {
		this.propagationStopped = true
	}
}

class FakeNode {
	constructor(tag) {
		this.tag = tag
		this.attrs = {}
		this.dataset = {}
		this.children = []
		this.parent = null
		this.textContent = ""
		this.disabled = false
		this.clicks = 0
		this.style = { setProperty: () => {} }
		this._listeners = {}
	}
	addEventListener(type, fn, capture = false) {
		;(this._listeners[type] ||= []).push({ fn, capture })
	}
	dispatchEvent(event) {
		event.target = this
		const path = []
		let node = this
		while (node) {
			path.push(node)
			node = node.parent
		}
		// capture phase (root -> target), then bubble phase (target -> root)
		for (const current of [...path].reverse()) {
			for (const entry of current._listeners[event.type] ?? []) {
				if (!entry.capture) continue
				event.currentTarget = current
				entry.fn(event)
				if (event.propagationStopped) return true
			}
		}
		for (const current of path) {
			for (const entry of current._listeners[event.type] ?? []) {
				if (entry.capture) continue
				event.currentTarget = current
				entry.fn(event)
				if (event.propagationStopped) return true
			}
		}
		return true
	}
	setAttribute(key, value) {
		this.attrs[key] = String(value)
	}
	get id() {
		return this.attrs.id ?? ""
	}
	set id(value) {
		this.attrs.id = String(value)
	}
	getAttribute(key) {
		return this.attrs[key] ?? null
	}
	appendChild(child) {
		child.parent = this
		this.children.push(child)
		return child
	}
	click() {
		this.clicks++
		const event = new FakeEvent("click")
		if (typeof this.onclick === "function") this.onclick(event)
		this.dispatchEvent(event)
	}
}

class FakeTextArea extends FakeNode {
	constructor() {
		super("textarea")
		this._value = ""
		this.selectionStart = 0
		this.selectionEnd = 0
	}
	get value() {
		return this._value
	}
	set value(next) {
		this._value = String(next)
	}
	focus() {}
}
// The script writes through the prototype setter, exactly like React does.
Object.defineProperty(FakeTextArea.prototype, "value", {
	get() {
		return this._value
	},
	set(next) {
		this._value = String(next)
	},
})

/* ------------------------------ fake document ----------------------------- */

const textarea = new FakeTextArea()
const submitButton = new FakeNode("button")
submitButton.setAttribute("type", "submit")
submitButton.setAttribute("aria-label", "Submit")

const form = new FakeNode("form")
form.children = [textarea]
textarea.parent = form
form.querySelector = (selector) =>
	selector.includes('button[type="submit"]') ? submitButton : null
form.closest = () => null
textarea.closest = () => form

const root = new FakeNode("div")
// Records the CSS variables the layer publishes from the visual viewport.
const styleVars = {}
root.style = {
	setProperty: (name, value) => {
		styleVars[name] = value
	},
}
const body = new FakeNode("body")
const head = new FakeNode("head")
body.appendChild(root)
// React attaches its handlers on the #root container, and the composer lives
// inside it: textarea -> form -> #root -> body.
form.parent = root
root.children.push(form)

let submitEvents = 0
form.addEventListener("submit", () => {
	submitEvents++
})
// React attaches its handlers on the root container, so the test does too.
let rootKeyHandlers = 0
root.addEventListener("keydown", () => {
	rootKeyHandlers++
	submitEvents++
})

const meta = new FakeNode("meta")
meta.setAttribute("content", "width=device-width, initial-scale=1.0")
meta.querySelector = () => null

const byId = new Map()

const document = {
	readyState: "loading",
	head,
	body,
	documentElement: root,
	execCommand: undefined,
	visibilityState: "visible",
	querySelector(selector) {
		if (selector === "form textarea") return textarea
		if (selector === 'meta[name="viewport"]') return meta
		return null
	},
	getElementById(id) {
		return byId.get(id) ?? null
	},
	createElement(tag) {
		const node = new FakeNode(tag)
		node.addEventListener("click", () => {})
		return node
	},
	addEventListener(type, fn) {
		;(this._listeners ||= {})[type] ||= []
		this._listeners[type].push(fn)
	},
	dispatchEvent(event) {
		for (const entry of (this._listeners?.[event.type] ?? []).map((fn) => ({ fn }))) {
			entry.fn(event)
		}
		return true
	},
}

const originalAppendChild = body.appendChild.bind(body)
body.appendChild = (child) => {
	if (child.attrs.id) byId.set(child.attrs.id, child)
	return originalAppendChild(child)
}
head.appendChild = (child) => {
	head.children.push(child)
	return child
}

/** Base WebSocket the script wraps; records frames and can push inbound ones. */
class FakeWebSocket {
	constructor(url) {
		this.url = url
		this.sent = []
		this._listeners = {}
		this.readyState = 1
	}
	addEventListener(type, fn) {
		;(this._listeners[type] ||= []).push(fn)
	}
	send(data) {
		this.sent.push(data)
	}
	emit(payload) {
		for (const fn of this._listeners.message ?? []) fn({ data: JSON.stringify(payload) })
	}
}

const window = {
	innerHeight: 844,
	innerWidth: 390,
	// A phone keyboard (height) plus a sideways overflow (width): the layout
	// viewport is wider than the part of the page the user can actually see.
	visualViewport: {
		height: 700,
		width: 320,
		addEventListener: () => {},
	},
	WebSocket: FakeWebSocket,
	matchMedia: (query) => ({ matches: query.includes("max-width: 820px") }),
}

const observers = []
const MutationObserver = class {
	constructor(callback) {
		this.callback = callback
		observers.push(this)
	}
	observe() {}
}
// The real page refreshes through MutationObserver; the test drives it by hand.
const refreshUi = () => observers.forEach((observer) => observer.callback())
const requestAnimationFrame = (fn) => fn()
const setInterval = () => 0
const Event = FakeEvent
const console2 = console

/* -------------------------------- run ------------------------------------ */

const source = readFileSync(join(HERE, "phone-ui.js"), "utf8")
// The injected file is a classic script, so run it with the fake globals.
new Function(
	"window",
	"document",
	"HTMLTextAreaElement",
	"MutationObserver",
	"requestAnimationFrame",
	"setInterval",
	"setTimeout",
	"clearTimeout",
	"Event",
	"console",
	source,
)(
	window,
	document,
	FakeTextArea,
	MutationObserver,
	requestAnimationFrame,
	setInterval,
	setTimeout,
	clearTimeout,
	Event,
	console,
)

document.dispatchEvent(new FakeEvent("DOMContentLoaded"))

check("phone layout style injected", head.children.some((node) => node.attrs.id === "cline-lan-phone-ui-css"))
check("viewport meta got viewport-fit=cover", (meta.getAttribute("content") ?? "").includes("viewport-fit=cover"))

const sendButton = byId.get("cline-lan-phone-ui-send")
check("floating send button created", Boolean(sendButton))
check("send button label is 送信", sendButton?.textContent === "送信")

// Enter with no modifier: newline, no submit, React's root handler must not run.
textarea.value = "abc"
textarea.selectionStart = textarea.selectionEnd = 3
textarea.dispatchEvent(new FakeEvent("keydown", { key: "Enter", shiftKey: false }))
check("Enter inserted a newline", textarea.value === "abc\n")
check("Enter did not submit", submitEvents === 0)
check("Enter never reached the React root handler", rootKeyHandlers === 0)
check("caret moved after the newline", textarea.selectionStart === 4)

// Shift+Enter: untouched, so the root handler (browser newline behaviour) runs.
textarea.value = "xyz"
textarea.selectionStart = textarea.selectionEnd = 3
textarea.dispatchEvent(new FakeEvent("keydown", { key: "Enter", shiftKey: true }))
check("Shift+Enter left to the browser", rootKeyHandlers === 1 && textarea.value === "xyz")

// IME composition (Japanese input): Enter must confirm the composition, not submit.
rootKeyHandlers = 0
textarea.value = "日本語"
textarea.selectionStart = textarea.selectionEnd = 3
textarea.dispatchEvent(new FakeEvent("keydown", { key: "Enter", shiftKey: false, isComposing: true }))
check("IME composition Enter left to the browser", rootKeyHandlers === 1)

// Send button drives the real submit button.
sendButton?.click()
check("send button clicked the submit button", submitButton.clicks === 1)

// While a turn is running the dashboard marks the submit button as Stop.
submitButton.setAttribute("aria-label", "Stop")
refreshUi()
check("send button switches to 停止 while generating", sendButton?.textContent === "停止")

// Disabled submit (empty prompt) must disable the send button.
submitButton.disabled = true
refreshUi()
check("send button disabled when submit is disabled", sendButton?.disabled === true)

/* ------------------------- stays inside the visible screen ----------------- */

const phoneStyle =
	head.children.find((node) => node.attrs.id === "cline-lan-phone-ui-css")?.textContent ?? ""
check("send button offset adds the sideways gap", phoneStyle.includes("var(--cline-lan-kbd-x"))
check("the page cannot scroll sideways", phoneStyle.includes("overflow-x: hidden"))
check("composer footer wraps instead of overflowing sideways", phoneStyle.includes("flex-wrap: wrap"))
check("sideways gap published from the visual viewport width", styleVars["--cline-lan-kbd-x"] === "70px")
check("keyboard gap published from the visual viewport height", styleVars["--cline-lan-kbd"] === "144px")

/* --------------------------- WebSocket mediation ------------------------- */

check("WebSocket is wrapped", window.WebSocket !== FakeWebSocket && window.WebSocket.__clineLanPhoneUi === true)

const socket = new window.WebSocket("ws://127.0.0.1:8787/browser")
socket.emit({
	type: "sessions",
	sessions: [{ sessionId: "session_A", workspaceRoot: "C:/work/a", providerId: "anthropic", modelId: "claude-x" }],
})
socket.send(JSON.stringify({ type: "attachSession", sessionId: "session_A" }))
socket.send(JSON.stringify({ type: "send", prompt: "hello", config: { mode: "act" } }))
check("app frames pass through untouched", socket.sent.length === 2)

socket.emit({ type: "error", text: "session not found: session_A" })
const restoreFrame = JSON.parse(socket.sent[2])
check("recovery asks the dashboard to restore the session", restoreFrame.type === "restore")
check("restore targets the latest checkpoint", restoreFrame.checkpointRunCount === 1000000)
check("recovery sends exactly one frame first", socket.sent.length === 3)

socket.emit({
	type: "sessions",
	sessions: [
		{ sessionId: "session_A", workspaceRoot: "C:/work/a" },
		{ sessionId: "session_R", workspaceRoot: "C:/work/a", providerId: "anthropic", modelId: "claude-x" },
	],
})
socket.emit({ type: "session_started", sessionId: "session_R" })
const continued = JSON.parse(socket.sent[3])
check("restored session receives the prompt", continued.type === "send" && continued.prompt === "hello")
check("continuation keeps provider and model", continued.config?.provider === "anthropic" && continued.config?.model === "claude-x")
check("continuation mode is preserved", continued.config?.mode === "act")
check("continuation toast shown", (byId.get("cline-lan-phone-ui-toast")?.textContent ?? "").includes("会話を継いで"))
check("continuation does not override the workspace", continued.config?.workspaceRoot === undefined)

socket.emit({ type: "error", text: "session not found: session_R" })
check("recovery runs once per prompt", socket.sent.length === 4)

const live = new window.WebSocket("ws://127.0.0.1:8787/browser")
live.emit({ type: "sessions", sessions: [{ sessionId: "session_B", workspaceRoot: "C:/work/b" }] })
live.send(JSON.stringify({ type: "attachSession", sessionId: "session_B" }))
live.send(JSON.stringify({ type: "send", prompt: "next", config: {} }))
live.emit({ type: "status", text: "ok" })
check("healthy send is untouched", live.sent.length === 2)

const unknown = new window.WebSocket("ws://127.0.0.1:8787/browser")
unknown.send(JSON.stringify({ type: "send", prompt: "x", config: {} }))
unknown.emit({ type: "error", text: "session not found: session_Z" })
check("unknown session is not auto-restored", !unknown.sent.some((raw) => JSON.parse(raw).type === "restore"))

/* Restore failure (no checkpoint) and timeouts fall back to a same-folder session. */
const noCheckpoint = new window.WebSocket("ws://127.0.0.1:8787/browser")
noCheckpoint.emit({ type: "sessions", sessions: [{ sessionId: "session_D", workspaceRoot: "C:/work/d" }] })
noCheckpoint.send(JSON.stringify({ type: "attachSession", sessionId: "session_D" }))
noCheckpoint.send(JSON.stringify({ type: "send", prompt: "q", config: {} }))
noCheckpoint.emit({ type: "error", text: "session not found: session_D" })
noCheckpoint.emit({ type: "error", text: "No checkpoint found at or before run 1000000 in session session_D" })
const fallbackFrames = noCheckpoint.sent.slice(2).map((raw) => JSON.parse(raw))
check("restore failure resets the peer selection", fallbackFrames.some((frame) => frame.type === "reset"))
check(
	"restore failure resends in the same folder",
	fallbackFrames.some((frame) => frame.type === "send" && frame.prompt === "q" && frame.config?.workspaceRoot === "C:/work/d"),
)
/** Run the layer with a specific tag query in a minimal environment. */
function runLayerWith(src) {
	const byId2 = new Map()
	const document2 = {
		readyState: "complete",
		currentScript: { src },
		head: { appendChild: () => {} },
		body: {
			appendChild: (child) => {
				if (child.id) byId2.set(child.id, child)
				return child
			},
		},
		createElement: (tag) => new FakeNode(tag),
		getElementById: (id) => byId2.get(id) ?? null,
		addEventListener: () => {},
	}
	const window2 = {
		innerHeight: 1200,
		innerWidth: 1200,
		visualViewport: null,
		WebSocket: FakeWebSocket,
		matchMedia: () => ({ matches: false }),
	}
	new Function(
		"window",
		"document",
		"HTMLTextAreaElement",
		"MutationObserver",
		"requestAnimationFrame",
		"setInterval",
		"setTimeout",
		"clearTimeout",
		"Event",
		"console",
		source,
	)(
		window2,
		document2,
		FakeTextArea,
		MutationObserver,
		requestAnimationFrame,
		setInterval,
		setTimeout,
		clearTimeout,
		Event,
		console,
	)
	return window2
}

const noRestore = runLayerWith("/assets/cline-lan-phone-ui.js?restore=0")
const disabled = new noRestore.WebSocket("ws://127.0.0.1:8787/browser")
disabled.emit({ type: "sessions", sessions: [{ sessionId: "session_C", workspaceRoot: "C:/work/c" }] })
disabled.send(JSON.stringify({ type: "attachSession", sessionId: "session_C" }))
disabled.send(JSON.stringify({ type: "send", prompt: "p", config: {} }))
disabled.emit({ type: "error", text: "session not found: session_C" })
const disabledFrames = disabled.sent.slice(2).map((raw) => JSON.parse(raw))
check("restore=0 never asks for a checkpoint restore", !disabledFrames.some((frame) => frame.type === "restore"))
check(
	"restore=0 falls back to the same folder",
	disabledFrames.some((frame) => frame.type === "send" && frame.prompt === "p" && frame.config?.workspaceRoot === "C:/work/c"),
)

const timedOut = runLayerWith("/assets/cline-lan-phone-ui.js?restoreTimeout=10")
const slow = new timedOut.WebSocket("ws://127.0.0.1:8787/browser")
slow.emit({ type: "sessions", sessions: [{ sessionId: "session_E", workspaceRoot: "C:/work/e" }] })
slow.send(JSON.stringify({ type: "attachSession", sessionId: "session_E" }))
slow.send(JSON.stringify({ type: "send", prompt: "t", config: {} }))
slow.emit({ type: "error", text: "session not found: session_E" })
check("restore is requested before waiting", JSON.parse(slow.sent[2]).type === "restore")
await new Promise((resolve) => setTimeout(resolve, 60))
const timeoutFrames = slow.sent.slice(2).map((raw) => JSON.parse(raw))
check(
	"restore timeout falls back to the same folder",
	timeoutFrames.some((frame) => frame.type === "send" && frame.prompt === "t" && frame.config?.workspaceRoot === "C:/work/e"),
)

console.log(failures === 0 ? "\nall phone UI checks passed" : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

