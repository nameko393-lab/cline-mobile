import { useEffect, useState } from "react";

const TOUCH_QUERY = "(pointer: coarse)";

/**
 * True on touch-primary layouts (phones, tablets).
 *
 * Only the composer's *sizing* depends on this. Keyboard semantics are the same
 * everywhere (see `lib/composer-keyboard.ts`), so a pointer change can never
 * strand a message that the user cannot send.
 */
export function useTouchLayout(): boolean {
	const [touch, setTouch] = useState(() => readTouchLayout());

	useEffect(() => {
		if (typeof window.matchMedia !== "function") {
			return;
		}
		const query = window.matchMedia(TOUCH_QUERY);
		const onChange = () => setTouch(query.matches);
		onChange();
		query.addEventListener("change", onChange);
		return () => query.removeEventListener("change", onChange);
	}, []);

	return touch;
}

function readTouchLayout(): boolean {
	if (
		typeof window === "undefined" ||
		typeof window.matchMedia !== "function"
	) {
		return false;
	}
	return window.matchMedia(TOUCH_QUERY).matches;
}
