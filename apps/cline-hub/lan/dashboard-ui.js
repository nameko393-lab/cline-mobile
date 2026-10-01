/*
 * Cline Hub LAN launcher — dashboard UI layer.
 *
 * Injected into the dashboard's BUILD OUTPUT by start.cmd and removed again by
 * stop.cmd, so Cline's own source stays untouched.
 *
 * Three things the stock dashboard does not offer:
 *   1. The Sessions tab has no way to start a new session.
 *   2. (phones only) The session title input has no confirm button — the rename
 *      on Enter, which mobile keyboards do not offer reliably.
 *   3. The trash button in the chat header deletes a session immediately,
 *      with no confirmation.
 *
 * All three are driven from the outside: the new-session button uses the
 * dashboard's own routing (the same pushState + popstate the app itself uses),
 * the rename button replays the Enter keydown the app commits on, and the
 * delete guard intercepts the click in the capture phase, so React never sees
 * it until the user confirms.
 *
 * Theme colors come from the dashboard's own CSS variables, which hold oklch()
 * values. They must be used as colors directly — wrapping them in hsl() yields
 * an invalid color and the element renders transparent.
 */
(function () {
	"use strict";

	const STYLE_ID = "cline-lan-dashboard-ui-css";
	const NEW_BUTTON_ID = "cline-lan-dashboard-ui-new-session";
	const RENAME_BUTTON_ID = "cline-lan-dashboard-ui-rename-confirm";
	const TITLE_INPUT_SELECTOR = 'input[placeholder="Session title"]';
	const DIALOG_ID = "cline-lan-dashboard-ui-confirm";
	const CONFIRMED_FLAG = "clineLanDeleteConfirmed";
	const SESSIONS_TITLE = "Sessions";
	const DELETE_LABEL = "Delete session";
	const CHAT_PATH = "/chat";
	const CHAT_SESSION_QUERY_PARAM = "id";

	/*
	 * Every write below must be conditional. The MutationObserver installed in
	 * boot() calls sync() on any childList change in the document, and assigning
	 * textContent replaces the child list even when the string is identical -
	 * so an unconditional write re-triggers the observer, which calls sync
	 * again, which writes again. With a composer on screen (the chat view) that
	 * loop pegs the main thread and the whole dashboard stops responding.
	 */
	function setText(element, text) {
		if (element.textContent !== text) element.textContent = text;
	}
	function setAttribute(element, name, value) {
		if (element.getAttribute(name) !== value) element.setAttribute(name, value);
	}
	function setData(element, key, value) {
		if (element.dataset[key] !== value) element.dataset[key] = value;
	}
	function setDisabled(element, disabled) {
		if (element.disabled !== disabled) element.disabled = disabled;
	}

	/** Nodes this layer owns, used to ignore our own mutations. */
	function isOurNode(node) {
		const element = node && node.nodeType === 1 ? node : node && node.parentElement;
		if (!element) return false;
		if ((element.id || "").indexOf("cline-lan-dashboard-ui") === 0) return true;
		if (element.id === STYLE_ID) return true;
		return Array.from(element.classList || []).some((name) => name.indexOf("cline-lan-") === 0);
	}

	function ensureStyle() {
		if (document.getElementById(STYLE_ID)) return;
		const style = document.createElement("style");
		style.id = STYLE_ID;
		style.textContent = [
			".cline-lan-new-session {",
			"	align-items: center;",
			"	background: var(--primary, #1f1f23);",
			"	border: 1px solid var(--border, #d4d4d4);",
			"	border-radius: var(--radius, 0.5rem);",
			"	color: var(--primary-foreground, #ffffff);",
			"	cursor: pointer;",
			"	display: inline-flex;",
			"	font: 500 14px/1.2 ui-sans-serif, system-ui, sans-serif;",
			"	min-height: 36px;",
			"	padding: 0 16px;",
			"}",
			".cline-lan-new-session:hover { opacity: 0.88; }",
			".cline-lan-rename-confirm {",
			"	align-items: center;",
			"	background: var(--primary, #1f1f23);",
			"	border: 1px solid var(--border, #d4d4d4);",
			"	border-radius: var(--radius, 0.5rem);",
			"	color: var(--primary-foreground, #ffffff);",
			"	cursor: pointer;",
			"	display: inline-flex;",
			"	flex: 0 0 auto;",
			"	font: 500 12px/1.2 ui-sans-serif, system-ui, sans-serif;",
			"	min-height: 26px;",
			"	padding: 0 10px;",
			"	white-space: nowrap;",
			"}",
			".cline-lan-rename-confirm:hover { opacity: 0.88; }",
			".cline-lan-confirm {",
			"	align-items: center;",
			"	background: rgba(0, 0, 0, 0.6);",
			"	display: flex;",
			"	inset: 0;",
			"	justify-content: center;",
			"	position: fixed;",
			"	z-index: 2147483000;",
			"}",
			".cline-lan-confirm-card {",
			"	background: var(--background, #ffffff);",
			"	border: 1px solid var(--border, #d4d4d4);",
			"	border-radius: var(--radius, 0.5rem);",
			"	box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);",
			"	color: var(--foreground, #1a1a1a);",
			"	max-width: 26rem;",
			"	padding: 20px;",
			"	width: min(26rem, calc(100vw - 32px));",
			"}",
			".cline-lan-confirm-title { font-size: 16px; font-weight: 600; margin: 0; }",
			".cline-lan-confirm-body {",
			"	color: var(--muted-foreground, #666666);",
			"	font-size: 14px;",
			"	line-height: 1.5;",
			"	margin: 10px 0 0;",
			"	overflow-wrap: anywhere;",
			"}",
			".cline-lan-confirm-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }",
			".cline-lan-confirm-actions button {",
			"	border: 1px solid var(--border, #d4d4d4);",
			"	border-radius: var(--radius, 0.5rem);",
			"	cursor: pointer;",
			"	font: 500 14px/1.2 ui-sans-serif, system-ui, sans-serif;",
			"	min-height: 36px;",
			"	padding: 0 14px;",
			"}",
			".cline-lan-confirm-cancel {",
			"	background: var(--secondary, var(--muted, #f0f0f0));",
			"	color: var(--foreground, #1a1a1a);",
			"}",
			".cline-lan-confirm-delete {",
			"	background: var(--destructive, #cc3333);",
			"	color: var(--destructive-foreground, #ffffff);",
			"}",

		].join("\n");
		document.head.appendChild(style);
	}

	function closeDialog(dialog) {
		if (dialog && dialog.parentNode) dialog.parentNode.removeChild(dialog);
		if (dialog && dialog.keyHandler) document.removeEventListener("keydown", dialog.keyHandler);
	}

	function openDeleteDialog(button) {
		const open = document.getElementById(DIALOG_ID);
		if (open) closeDialog(open);

		const titleInput = document.querySelector(TITLE_INPUT_SELECTOR);
		const sessionTitle = titleInput && titleInput.value ? titleInput.value.trim() : "";

		const dialog = document.createElement("div");
		dialog.id = DIALOG_ID;
		dialog.className = "cline-lan-confirm";

		const card = document.createElement("div");
		card.className = "cline-lan-confirm-card";
		card.setAttribute("role", "alertdialog");
		card.setAttribute("aria-modal", "true");

		const title = document.createElement("p");
		title.className = "cline-lan-confirm-title";
		title.textContent = "セッションを削除しますか？";

		const body = document.createElement("p");
		body.className = "cline-lan-confirm-body";
		body.textContent = sessionTitle
			? `「${sessionTitle}」を削除します。この操作は取り消せません。`
			: "このセッションを削除します。この操作は取り消せません。";

		const actions = document.createElement("div");
		actions.className = "cline-lan-confirm-actions";

		const cancel = document.createElement("button");
		cancel.type = "button";
		cancel.className = "cline-lan-confirm-cancel";
		cancel.textContent = "キャンセル";

		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "cline-lan-confirm-delete";
		remove.textContent = "削除";

		actions.appendChild(cancel);
		actions.appendChild(remove);
		card.appendChild(title);
		card.appendChild(body);
		card.appendChild(actions);
		dialog.appendChild(card);
		document.body.appendChild(dialog);

		const dismiss = () => closeDialog(dialog);
		dialog.keyHandler = (event) => {
			if (event.key === "Escape") dismiss();
		};
		document.addEventListener("keydown", dialog.keyHandler);

		dialog.addEventListener("click", (event) => {
			if (event.target === dialog) dismiss();
		});
		cancel.addEventListener("click", (event) => {
			event.stopPropagation();
			dismiss();
		});
		remove.addEventListener("click", (event) => {
			event.stopPropagation();
			dismiss();
			// Mark the button so the capture guard below lets this click through.
			button.dataset[CONFIRMED_FLAG] = "1";
			button.click();
		});
		if (typeof cancel.focus === "function") cancel.focus();
	}

	function deleteButtonFor(target) {
		const button = target && target.closest ? target.closest("button") : null;
		if (!button) return null;
		const label = button.querySelector(".sr-only");
		if (!label) return null;
		return (label.textContent || "").trim() === DELETE_LABEL ? button : null;
	}

	function guardDeleteClicks() {
		document.addEventListener(
			"click",
			(event) => {
				const button = deleteButtonFor(event.target);
				if (!button) return;
				if (button.dataset[CONFIRMED_FLAG] === "1") {
					delete button.dataset[CONFIRMED_FLAG];
					return;
				}
				// React attaches its listeners to the root container, so stopping
				// the capture phase here keeps the delete from running at all.
				event.preventDefault();
				event.stopPropagation();
				openDeleteDialog(button);
			},
			true,
		);
	}

	/** The Sessions tab header, found by its "Sessions" heading. */
	function sessionsHeader() {
		const headings = document.querySelectorAll("h1");
		for (const heading of headings) {
			if ((heading.textContent || "").trim() !== SESSIONS_TITLE) continue;
			if (heading.closest) {
				const section = heading.closest("section");
				if (section) return section;
			}
			return heading.parentElement;
		}
		return null;
	}

	/** Mirrors the dashboard's own chatPath(): keep the query, drop the session id. */
	function newSessionPath() {
		const params = new URLSearchParams(window.location.search);
		params.delete(CHAT_SESSION_QUERY_PARAM);
		const query = params.toString();
		return query ? `${CHAT_PATH}?${query}` : CHAT_PATH;
	}

	function startNewSession() {
		window.history.pushState(null, "", newSessionPath());
		window.dispatchEvent(new PopStateEvent("popstate"));
	}

	/**
	 * Phone-shaped viewport (touch screen or a narrow window). The confirm
	 * button only helps there: a PC keyboard offers Enter, and a stray button
	 * in the chat header is noise. Mirrors the dashboard source's own touch
	 * layout query (lib/use-touch-layout.ts).
	*/
	function isPhoneViewport() {
		if (typeof window.matchMedia !== "function") return false;
		return (
			window.matchMedia("(pointer: coarse)").matches ||
			window.matchMedia("(max-width: 820px)").matches
		);
	}

	/**
	 * The dashboard commits a renamed session on an Enter keydown (and on blur),
	 * so the confirm button replays that keydown instead of writing the title
	 * through a path of its own.
	 *
	 * The input must not be focused here: its own onFocus resets the draft to the
	 * saved title, which drops what the user typed and makes the commit a no-op.
	 */
	function commitTitle(input) {
		input.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
		);
		// Tapping the button blurs the input, and the dashboard commits on blur.
		// Blur only when it is still focused so that path is not fired twice.
		if (document.activeElement === input && typeof input.blur === "function") {
			input.blur();
		}
	}

	function syncRenameButton() {
		const input = document.querySelector(TITLE_INPUT_SELECTOR);
		const existing = document.getElementById(RENAME_BUTTON_ID);
		if (!input || !input.parentNode || !isPhoneViewport()) {
			if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
			return;
		}
		if (existing && existing.parentNode === input.parentNode) return;
		if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

		const button = document.createElement("button");
		button.id = RENAME_BUTTON_ID;
		button.type = "button";
		button.className = "cline-lan-rename-confirm";
		button.textContent = "確定";
		button.addEventListener("click", (event) => {
			event.preventDefault();
			commitTitle(input);
		});
		input.parentNode.insertBefore(button, input.nextSibling);
	}

	function syncNewSessionButton() {
		const section = sessionsHeader();
		const existing = document.getElementById(NEW_BUTTON_ID);
		if (!section) {
			if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
			return;
		}
		if (existing && existing.parentNode === section) return;
		if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

		const button = document.createElement("button");
		button.id = NEW_BUTTON_ID;
		button.type = "button";
		button.className = "cline-lan-new-session";
		button.textContent = "新規セッション";
		button.addEventListener("click", startNewSession);
		section.appendChild(button);
	}



	function sync() {
		syncNewSessionButton();
		syncRenameButton();
			}

	function boot() {
		ensureStyle();
		guardDeleteClicks();
		sync();
		if (typeof MutationObserver === "function") {
			new MutationObserver((records) => {
				// Mutations that only touch nodes this layer owns are our own.
				// Reacting to them is what turned sync into a self-feeding loop.
				if (records.length && records.every((record) => isOurNode(record.target))) return;
				sync();
			}).observe(document.body, {
				childList: true,
				subtree: true,
			});
		}
		setInterval(sync, 500);
		console.info(
			"[cline-lan-dashboard-ui] new-session + rename confirm + delete confirm installed",
		);
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", boot);
	} else {
		boot();
	}
})();


