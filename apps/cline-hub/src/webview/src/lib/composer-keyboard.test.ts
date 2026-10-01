import { describe, expect, it } from "vitest";
import { insertNewlineAtCursor, resolveEnterAction } from "./composer-keyboard";

describe("resolveEnterAction", () => {
	it("turns a plain Enter into a newline so multi-line prompts stay typeable", () => {
		expect(
			resolveEnterAction({
				enterIsNewline: true,
				isComposing: false,
				key: "Enter",
				shiftKey: false,
			}),
		).toBe("newline");
	});

	it("leaves Shift+Enter to the browser, which already inserts a newline", () => {
		expect(
			resolveEnterAction({
				enterIsNewline: true,
				isComposing: false,
				key: "Enter",
				shiftKey: true,
			}),
		).toBe("none");
	});

	it("never hijacks Enter while a Japanese IME is composing", () => {
		expect(
			resolveEnterAction({
				enterIsNewline: true,
				isComposing: true,
				key: "Enter",
				shiftKey: false,
			}),
		).toBe("none");
	});

	it("falls back to keyCode 229 for Safari, which never reports isComposing", () => {
		expect(
			resolveEnterAction({
				enterIsNewline: true,
				isComposing: false,
				key: "Enter",
				keyCode: 229,
				shiftKey: false,
			}),
		).toBe("none");
	});

	it("ignores every other key", () => {
		for (const key of ["a", "Tab", "Escape", "Backspace", " "]) {
			expect(
				resolveEnterAction({
					enterIsNewline: true,
					isComposing: false,
					key,
					shiftKey: false,
				}),
			).toBe("none");
		}
	});

	it("does nothing when the composer keeps the submit-on-Enter default", () => {
		expect(
			resolveEnterAction({
				enterIsNewline: false,
				isComposing: false,
				key: "Enter",
				shiftKey: false,
			}),
		).toBe("none");
	});
});

describe("insertNewlineAtCursor", () => {
	it("inserts into an empty composer and leaves the caret after the newline", () => {
		expect(insertNewlineAtCursor("", 0, 0)).toEqual({ caret: 1, value: "\n" });
	});

	it("splits the line at the caret", () => {
		expect(insertNewlineAtCursor("abc", 1, 1)).toEqual({
			caret: 2,
			value: "a\nbc",
		});
	});

	it("replaces a selected range, like the browser does", () => {
		expect(insertNewlineAtCursor("hello world", 5, 11)).toEqual({
			caret: 6,
			value: "hello\n",
		});
	});

	it("appends at the end of the text", () => {
		expect(insertNewlineAtCursor("line", 4, 4)).toEqual({
			caret: 5,
			value: "line\n",
		});
	});

	it("clamps out-of-range offsets instead of throwing", () => {
		expect(insertNewlineAtCursor("ab", 9, 9)).toEqual({
			caret: 3,
			value: "ab\n",
		});
		expect(insertNewlineAtCursor("ab", 2, 1)).toEqual({
			caret: 3,
			value: "ab\n",
		});
	});

	it("keeps the caret aligned when text is already multi-line", () => {
		expect(insertNewlineAtCursor("one\ntwo", 4, 4)).toEqual({
			caret: 5,
			value: "one\n\ntwo",
		});
	});
});
