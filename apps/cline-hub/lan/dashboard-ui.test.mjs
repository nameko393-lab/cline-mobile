/*
 * dashboard-ui.js behaviour test (no browser needed): bun dashboard-ui.test.mjs
 *
 * Fake DOM mirroring the dashboard layout:
 *   document > body > root (React root container) > chat header + sessions header
 * The root container has a bubbling click listener, like React's delegated
 * listeners, so the tests can prove the guard keeps React from seeing a click.
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
		Object.assign(this, init)
	}
	preventDefault() {
		this.defaultPrevented = true
	}
	stopPropagation() {
		this.propagationStopped = true
	}
}

class PopStateEvent {
	constructor(type) {
		this.type = type
	}
}

class Event {
	constructor(type, init = {}) {
		this.type = type
		Object.assign(this, init)
	}
}

class KeyboardEvent {
	constructor(type, init = {}) {
		this.type = type
		this.key = init.key ?? ""
		this.shiftKey = init.shiftKey ?? false
		this.isComposing = init.isComposing ?? false
		this.target = null
		this.currentTarget = null
		this.defaultPrevented = false
		this.propagationStopped = false
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
		this.parentNode = null
		this.textContent = ""
		this.className = ""
		this.style = { setProperty: () => {} }
		this._listeners = {}
	}
	addEventListener(type, fn, capture = false) {
		;(this._listeners[type] ||= []).push({ fn, capture })
	}
	removeEventListener(type, fn) {
		this._listeners[type] = (this._listeners[type] ?? []).filter((entry) => entry.fn !== fn)
	}
	dispatchEvent(event) {
		const path = []
		let node = this
		while (node) {
			path.push(node)
			node = node.parentNode
		}
		event.target = this
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
	getAttribute(key) {
		return this.attrs[key] ?? null
	}
	get id() {
		return this.attrs.id ?? ""
	}
	set id(value) {
		this.attrs.id = String(value)
	}
	appendChild(child) {
		child.parentNode = this
		this.children.push(child)
		return child
	}
	removeChild(child) {
		this.children = this.children.filter((item) => item !== child)
		child.parentNode = null
		return child
	}
	insertBefore(child, reference) {
		child.parentNode = this
		const index = reference ? this.children.indexOf(reference) : -1
		if (index === -1) this.children.push(child)
		else this.children.splice(index, 0, child)
		return child
	}
	get nextSibling() {
		if (!this.parentNode) return null
		const index = this.parentNode.children.indexOf(this)
		return this.parentNode.children[index + 1] ?? null
	}
	get previousSibling() {
		if (!this.parentNode) return null
		const index = this.parentNode.children.indexOf(this)
		return index > 0 ? this.parentNode.children[index - 1] : null
	}
	click() {
		this.dispatchEvent(new FakeEvent("click"))
	}
	focus() {}
	matchesSelector(selector) {
		if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1))
		const compound = /^([a-z0-9-]*)\s*(\[[^\]]+\])?$/i.exec(selector)
		if (!compound) return false
		const [, tag, attribute] = compound
		if (tag && this.tag !== tag) return false
		if (attribute) {
			const inner = attribute.slice(1, -1)
			const eq = inner.indexOf("=")
			const key = eq === -1 ? inner : inner.slice(0, eq)
			const value = eq === -1 ? undefined : inner.slice(eq + 1).replace(/^"|"$/g, "")
			if (value === undefined) {
				if (this.attrs[key] === undefined) return false
			} else if (this.attrs[key] !== value) {
				return false
			}
		}
		return Boolean(tag || attribute)
	}
	querySelector(selector) {
		for (const child of this.children) {
			if (child.matchesSelector(selector)) return child
			const found = child.querySelector(selector)
			if (found) return found
		}
		return null
	}
	querySelectorAll(selector) {
		const found = []
		for (const child of this.children) {
			if (child.matchesSelector(selector)) found.push(child)
			found.push(...child.querySelectorAll(selector))
		}
		return found
	}
	closest(selector) {
		let node = this
		while (node) {
			if (node.matchesSelector(selector)) return node
			node = node.parentNode
		}
		return null
	}
}

/* -------------------------------- fake DOM --------------------------------- */

const documentNode = new FakeNode("#document")
documentNode.readyState = "complete"
documentNode.createElement = (tag) => new FakeNode(tag)
const head = documentNode.appendChild(new FakeNode("head"))
const body = documentNode.appendChild(new FakeNode("body"))
documentNode.head = head
documentNode.body = body

const findById = (id) => {
	const walk = (node) => {
		for (const child of node.children) {
			if (child.id === id) return child
			const found = walk(child)
			if (found) return found
		}
		return null
	}
	return walk(documentNode)
}
documentNode.getElementById = findById
documentNode.querySelector = (selector) => {
	if (selector === "form textarea") return composerTextarea
	return body.querySelector(selector)
}
documentNode.querySelectorAll = (selector) => body.querySelectorAll(selector)

// React delegates its listeners to the root container.
let rootClicks = 0
let deleteClicks = 0
const root = body.appendChild(new FakeNode("div"))
root.addEventListener("click", (event) => {
	rootClicks++
	if (event.target === deleteButton) deleteClicks++
})

const chatHeader = root.appendChild(new FakeNode("div"))
const titleInput = chatHeader.appendChild(new FakeNode("input"))
titleInput.setAttribute("placeholder", "Session title")
titleInput.value = "LAN 検証セッション"

const deleteButton = chatHeader.appendChild(new FakeNode("button"))
const deleteLabel = deleteButton.appendChild(new FakeNode("span"))
deleteLabel.className = "sr-only"
deleteLabel.textContent = "Delete session"

const newChatButton = chatHeader.appendChild(new FakeNode("button"))
const newChatLabel = newChatButton.appendChild(new FakeNode("span"))
newChatLabel.className = "sr-only"
newChatLabel.textContent = "New chat"

const sessionsSection = root.appendChild(new FakeNode("section"))
const sessionsHeading = sessionsSection.appendChild(new FakeNode("h1"))
sessionsHeading.textContent = "Sessions"

// The composer: a form holding the prompt textarea and the app's submit button.
let rootKeydowns = 0
root.addEventListener("keydown", (event) => {
	if (event.target === composerTextarea) rootKeydowns++
})
const composerForm = root.appendChild(new FakeNode("form"))
const composerTextarea = composerForm.appendChild(new FakeNode("textarea"))
composerTextarea.value = "C:\\temp\\log"
composerTextarea.selectionStart = composerTextarea.selectionEnd = composerTextarea.value.length
composerTextarea.closest = () => composerForm
const composerSubmit = composerForm.appendChild(new FakeNode("button"))
composerSubmit.setAttribute("type", "submit")
composerSubmit.setAttribute("aria-label", "Submit")
composerSubmit.clicks = 0
composerSubmit.click = () => {
	composerSubmit.clicks++
	composerSubmit.dispatchEvent(new FakeEvent("click"))
}
composerForm.querySelector = (selector) =>
	selector.includes('button[type="submit"]') ? composerSubmit : null

const pushStateCalls = []
const dispatched = []
const window = {
	location: { pathname: "/sessions", search: "?roomSecret=secretvalue&id=stale-session" },
	history: { pushState: (_state, _title, url) => pushStateCalls.push(url) },
	dispatchEvent: (event) => {
		dispatched.push(event.type)
		return true
	},
	// Desktop: neither touch nor narrow, so the dashboard layer owns the composer.
	matchMedia: () => ({ matches: false }),
}

const source = readFileSync(join(HERE, "dashboard-ui.js"), "utf8")

const observers = []
const MutationObserver = class {
	constructor(callback) {
		this.callback = callback
		observers.push(this)
	}
	observe() {}
}
// The real page re-syncs through MutationObserver; the test drives it by hand.
// Records carry a page-owned target so the layer does not treat them as its own.
const refreshUi = () =>
	observers.forEach((observer) => observer.callback([{ target: documentNode }]))

const runLayer = (doc, win) =>
	new Function(
		"window",
		"document",
		"MutationObserver",
		"setInterval",
		"PopStateEvent",
		"KeyboardEvent",
		"URLSearchParams",
		"Event",
		"console",
		source,
	)(
		win,
		doc,
		MutationObserver,
		() => 0,
		PopStateEvent,
		KeyboardEvent,
		URLSearchParams,
		Event,
		console,
	)

runLayer(documentNode, window)

/* ---------------------------------- tests ---------------------------------- */

check("style injected", Boolean(findById("cline-lan-dashboard-ui-css")))
check(
	"CSS uses the dashboard color variables directly (they hold oklch values; hsl(var(...)) renders transparent)",
	findById("cline-lan-dashboard-ui-css").textContent.includes("var(--background") &&
		!findById("cline-lan-dashboard-ui-css").textContent.includes("hsl(var("),
)

const newSessionButton = findById("cline-lan-dashboard-ui-new-session")
check("new session button added to the Sessions header", Boolean(newSessionButton))
check("new session button lives in the header section", newSessionButton?.parentNode === sessionsSection)
check("new session button label is 新規セッション", newSessionButton?.textContent === "新規セッション")

newSessionButton?.click()
check(
	"new session keeps the query and drops the session id",
	pushStateCalls[0] === "/chat?roomSecret=secretvalue",
)
check("new session drives the app router", dispatched[0] === "popstate")

const renameButton = findById("cline-lan-dashboard-ui-rename-confirm")
check("rename confirm button added", Boolean(renameButton))
check("rename button sits beside the title input", renameButton?.parentNode === chatHeader)
check("rename button sits right after the title input", renameButton?.previousSibling === titleInput)
check("rename button label is 確定", renameButton?.textContent === "確定")

const pressedKeys = []
titleInput.addEventListener("keydown", (event) => pressedKeys.push(event.key))
let titleFocusCalls = 0
let titleBlurCalls = 0
titleInput.focus = () => {
	titleFocusCalls++
}
titleInput.blur = () => {
	titleBlurCalls++
}
renameButton?.click()
check(
	"rename button replays the Enter keydown the dashboard commits a rename on",
	pressedKeys.length === 1 && pressedKeys[0] === "Enter",
)
check(
	"rename button does not focus the input (its onFocus resets the draft to the saved title)",
	titleFocusCalls === 0,
)
check("rename button does not blur an unfocused input", titleBlurCalls === 0)

documentNode.activeElement = titleInput
renameButton?.click()
check("rename button blurs a focused input so the app commits once", titleBlurCalls === 1 && pressedKeys.length === 2)
documentNode.activeElement = null

/* -------------------------------- composer --------------------------------- */
/*
	* The injected layer no longer touches the composer: the PC dashboard keeps
	* its native Enter-to-send, and the phone send button lives in the dashboard
	* source (Composer.tsx) as a button pinned to the bottom-right.
*/

const pressEnter = (init = {}) => {
	const event = new KeyboardEvent("keydown", { key: "Enter", ...init })
	composerTextarea.dispatchEvent(event)
	return event
}

check("no send button is injected into the composer", findById("cline-lan-dashboard-ui-send") === null)
check("no Enter handler is registered on the composer textarea", (composerTextarea._listeners.keydown ?? []).length === 0)

const enterEvent = pressEnter()
check("Enter is left to the app (not preventDefault-ed)", !enterEvent.defaultPrevented)
check("Enter reaches the app key handler on the React root", rootKeydowns === 1)
check("Enter does not click the app submit button", composerSubmit.clicks === 0)

const shiftEnter = pressEnter({ shiftKey: true })
check("Shift+Enter is left to the browser", !shiftEnter.defaultPrevented)
check("Shift+Enter reaches the app key handler", rootKeydowns === 2)

const imeEnter = pressEnter({ isComposing: true })
check("IME composition Enter is left alone", !imeEnter.defaultPrevented)
check("IME composition Enter reaches the app key handler", rootKeydowns === 3)

/* Regression: the page re-syncs through a MutationObserver, and assigning
 * textContent replaces the child list even when the string is identical. An
 * unconditional write inside sync therefore re-triggers the observer, which
 * calls sync again - the self-feeding loop that pegged the main thread and
 * froze the PC dashboard the moment a chat view opened. */
const watchedNode = findById("cline-lan-dashboard-ui-new-session")
const watchedLabel = watchedNode?.textContent ?? ""
let layerDomWrites = 0
if (watchedNode) {
	Object.defineProperty(watchedNode, "textContent", {
		configurable: true,
		get: () => watchedLabel,
		set: () => {
			layerDomWrites += 1
		}
	})
}
refreshUi()
refreshUi()
check(
	`repeated sync with no page change writes nothing to the DOM (writes=${layerDomWrites})`,
	layerDomWrites === 0,
)
check("new session button keeps its label across no-op syncs", watchedNode?.textContent === watchedLabel)
check(
	"our own mutations do not trigger a re-sync",
	(() => {
		const ourNode = documentNode.createElement("div")
		ourNode.setAttribute("data-cline-lan-dashboard-ui", "1")
		observers.forEach((observer) => observer.callback([{ target: ourNode }]))
		return watchedNode?.textContent === watchedLabel && layerDomWrites === 0
	})(),
)

const dialogHost = () => findById("cline-lan-dashboard-ui-confirm")

deleteButton.click()
const dialog = dialogHost()
check("delete click opens a confirmation dialog", Boolean(dialog))
check("delete click never reaches the React root handler", deleteClicks === 0)
check("dialog asks for confirmation in Japanese", (dialog?.querySelector(".cline-lan-confirm-title")?.textContent ?? "").includes("削除しますか"))
check("dialog names the session", (dialog?.querySelector(".cline-lan-confirm-body")?.textContent ?? "").includes("LAN 検証セッション"))

const cancel = dialog?.querySelector(".cline-lan-confirm-cancel")
cancel?.click()
check("cancel closes the dialog", dialogHost() === null)
check("cancel does not delete", deleteClicks === 0)

deleteButton.click()
const confirmDelete = dialogHost()?.querySelector(".cline-lan-confirm-delete")
confirmDelete?.click()
check("confirm closes the dialog", dialogHost() === null)
check("confirm lets the delete through to React", deleteClicks === 1)
check("confirmation flag is cleared after use", deleteButton.dataset.clineLanDeleteConfirmed === undefined)

deleteButton.click()
check("delete asks again next time", Boolean(dialogHost()) && deleteClicks === 1)
findById("cline-lan-dashboard-ui-confirm")?.querySelector(".cline-lan-confirm-cancel")?.click()

newChatButton.click()
check("other buttons are untouched", deleteClicks === 1 && rootClicks > 1)

sessionsHeading.parentNode = null
sessionsSection.parentNode = null
root.removeChild(sessionsSection)
check("button disappears when the Sessions view is gone", findById("cline-lan-dashboard-ui-new-session")?.parentNode === undefined)
check("rename button stays while the chat header is open", findById("cline-lan-dashboard-ui-rename-confirm")?.parentNode === chatHeader)

/* --------------- phone-shaped viewport: the phone layer owns it ------------ */

const walkFind = (node, id) => {
	for (const child of node.children) {
		if (child.id === id) return child
		const found = walkFind(child, id)
		if (found) return found
	}
	return null
}

/** A dashboard page holding a composer, for the phone-shaped scenarios. */
function makeComposerDoc() {
	const doc = new FakeNode("#document")
	doc.readyState = "complete"
	doc.createElement = (tag) => new FakeNode(tag)
	doc.head = doc.appendChild(new FakeNode("head"))
	doc.body = doc.appendChild(new FakeNode("body"))
	doc.getElementById = (id) => walkFind(doc, id)
	doc.querySelector = (selector) => doc.body.querySelector(selector)
	doc.querySelectorAll = (selector) => doc.body.querySelectorAll(selector)
	const pageRoot = doc.body.appendChild(new FakeNode("div"))
	const form = pageRoot.appendChild(new FakeNode("form"))
	const textarea = form.appendChild(new FakeNode("textarea"))
	textarea.value = "hello"
	textarea.selectionStart = textarea.selectionEnd = 5
	textarea.closest = () => form
	const submit = form.appendChild(new FakeNode("button"))
	submit.setAttribute("type", "submit")
	form.querySelector = (selector) => (selector.includes('button[type="submit"]') ? submit : null)
	return { doc, form, textarea, submit }
}

// Touch screen / portrait width: exactly the phone layer's own test.
const phoneWindow = {
	location: { pathname: "/chat", search: "" },
	history: { pushState: () => {} },
	dispatchEvent: () => true,
	matchMedia: (query) => ({ matches: query.includes("max-width: 820px") }),
}

const phone = makeComposerDoc()
phone.textarea.dataset.clineLanPhoneUi = "1"
const phoneSend = phone.doc.body.appendChild(new FakeNode("button"))
phoneSend.id = "cline-lan-phone-ui-send"
runLayer(phone.doc, phoneWindow)

check("phone composer gets no dashboard send button", walkFind(phone.doc, "cline-lan-dashboard-ui-send") === null)
check("phone composer gets no second Enter handler", (phone.textarea._listeners.keydown ?? []).length === 0)

// Same narrow viewport with no phone layer present: an inline button in the
// composer footer would overflow the row and land past the right edge, so the
// dashboard layer must stay off the composer there too.
const narrow = makeComposerDoc()
runLayer(narrow.doc, phoneWindow)

check("narrow viewport gets no inline send button", walkFind(narrow.doc, "cline-lan-dashboard-ui-send") === null)
check("narrow viewport leaves Enter to the phone layer", (narrow.textarea._listeners.keydown ?? []).length === 0)

console.log(failures === 0 ? "\nall dashboard UI checks passed" : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)

