/**
 * Keyboard semantics for the hub composer.
 *
 * The hub dashboard is opened on phones too, and there the on-screen keyboard
 * makes "Enter submits" unusable: a multi-line prompt cannot be typed, and
 * hijacking Enter while a Japanese IME is composing dismisses the candidate
 * window. So Enter inserts a newline and sending goes through the send button.
 * Shift+Enter and IME composition are left to the browser.
 *
 * This is the source-level replacement for the runtime DOM patching the
 * standalone LAN launcher used to inject into the built dashboard assets.
 */

export type ComposerEnterAction = "newline" | "none";

export interface ComposerEnterInput {
	/** Enter inserts a newline instead of submitting the form. */
	enterIsNewline: boolean;
	/** `KeyboardEvent.isComposing`: an IME candidate window is open. */
	isComposing: boolean;
	/** `KeyboardEvent.key`. */
	key: string;
	/**
	 * `KeyboardEvent.keyCode`. Safari never reports `isComposing`, so 229 is
	 * its only composition signal.
	 */
	keyCode?: number;
	shiftKey: boolean;
}

/**
 * Decide what a keydown should do. Anything other than "newline" is left to
 * the browser and to `PromptInputTextarea`'s own handling.
 */
export function resolveEnterAction({
	enterIsNewline,
	isComposing,
	key,
	keyCode,
	shiftKey,
}: ComposerEnterInput): ComposerEnterAction {
	if (!enterIsNewline) {
		return "none";
	}
	if (key !== "Enter") {
		return "none";
	}
	// Shift+Enter already inserts a newline, so there is nothing to override.
	if (shiftKey) {
		return "none";
	}
	// Never touch Enter while the user is composing text.
	if (isComposing || keyCode === 229) {
		return "none";
	}
	return "newline";
}

export interface NewlineInsert {
	/** The textarea value after the newline is inserted. */
	value: string;
	/** Caret offset to restore in the new value. */
	caret: number;
}

/**
 * Insert a newline at the caret with the same semantics the browser applies to
 * the Enter key: a selected range is replaced, an empty range is expanded.
 */
export function insertNewlineAtCursor(
	value: string,
	selectionStart: number,
	selectionEnd: number,
): NewlineInsert {
	const start = Math.max(0, Math.min(selectionStart, value.length));
	const end = Math.max(start, Math.min(selectionEnd, value.length));
	return {
		value: `${value.slice(0, start)}\n${value.slice(end)}`,
		caret: start + 1,
	};
}
