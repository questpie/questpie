/**
 * Regression test for the markdown-mode rich-text data-loss bug.
 *
 * Bug: opening a `kind:"document"` view whose body is an
 * `f.richText({ mode:"markdown" })` field WIPED the stored body. Root cause:
 * `buildExtensions` dropped the `outputMode` option when forwarding to
 * `buildBaseExtensions`, so the `tiptap-markdown` `Markdown` extension was
 * NEVER added in markdown mode. Consequences:
 *   1. The stored markdown string was not parsed on load → the editor rendered
 *      empty (placeholder), losing the visible content.
 *   2. `getOutput(editor, "markdown")` reads `editor.storage.markdown.getMarkdown()`,
 *      which is `undefined` without the extension → it returned `""`. Any
 *      settle/edit transaction then emitted `onChange("")`, marking the form
 *      dirty and autosaving an EMPTY body → corruption.
 *
 * These tests pin the root-cause unit (extension wiring) plus the supporting
 * `getOutput`/`isSameValue` contracts that gate the autosave no-op guard.
 *
 * NOTE: bun:test has no DOM, so a live TipTap `Editor` (which needs a DOM
 * element) cannot be instantiated here. The full visual repro — open a real
 * doc, body renders, body NOT wiped — is re-verified by the controller. See the
 * `onUpdate` no-op guard in `index.tsx` for the second half of the fix.
 */

import { describe, expect, test } from "bun:test";

import { buildExtensions } from "../../src/client/components/fields/rich-text-editor/extensions";
import { defaultFeatures } from "../../src/client/components/fields/rich-text-editor/types";
import {
	getOutput,
	isSameValue,
} from "../../src/client/components/fields/rich-text-editor/utils";

/** Resolve the (possibly async) extension build to a flat name list. */
async function extensionNames(
	build: ReturnType<typeof buildExtensions>,
): Promise<string[]> {
	const exts = build instanceof Promise ? await build : build;
	return exts.map((e) => (e as { name: string }).name);
}

describe("rich-text markdown mode — extension wiring (root cause)", () => {
	test("outputMode:'markdown' includes the tiptap-markdown extension", async () => {
		// `codeBlock:false` keeps the build synchronous (no lowlight import), which
		// is irrelevant to the markdown wiring but keeps the test fast.
		const names = await extensionNames(
			buildExtensions({
				features: { ...defaultFeatures, codeBlock: false },
				outputMode: "markdown",
			}),
		);

		// THE regression: before the fix this was absent (outputMode was dropped
		// before reaching `buildBaseExtensions`), so markdown never parsed/serialized.
		expect(names).toContain("markdown");
	});

	test("outputMode:'json' (and default) omits the markdown extension", async () => {
		const jsonNames = await extensionNames(
			buildExtensions({
				features: { ...defaultFeatures, codeBlock: false },
				outputMode: "json",
			}),
		);
		expect(jsonNames).not.toContain("markdown");

		const defaultNames = await extensionNames(
			buildExtensions({
				features: { ...defaultFeatures, codeBlock: false },
			}),
		);
		expect(defaultNames).not.toContain("markdown");
	});
});

describe("rich-text markdown mode — getOutput / no-op guard contracts", () => {
	test("getOutput('markdown') reads getMarkdown() from editor storage", () => {
		// Faithful stand-in for the TipTap editor surface getOutput touches. With
		// the markdown extension present, `storage.markdown.getMarkdown()` returns
		// the round-tripped markdown — NOT the empty string that corrupted the body.
		const body = "# Fresh Doc\n\nSome **bold** body text.";
		const fakeEditor = {
			storage: { markdown: { getMarkdown: () => body } },
			getJSON: () => ({ type: "doc" }),
		};

		expect(getOutput(fakeEditor as never, "markdown")).toBe(body);
	});

	test("getOutput('markdown') falls back to '' only when storage is absent (the bug shape)", () => {
		// This is exactly what happened pre-fix: no markdown extension → no
		// `storage.markdown` → getOutput returns "". The fix prevents this branch
		// from ever being hit in markdown mode by ensuring the extension is added.
		const fakeEditor = { storage: {}, getJSON: () => ({ type: "doc" }) };
		expect(getOutput(fakeEditor as never, "markdown")).toBe("");
	});

	test("isSameValue suppresses a no-op re-emit of identical markdown", () => {
		// The `onUpdate` guard skips the emit when the serialized value equals the
		// last applied value. A settle transaction that re-produces the loaded body
		// therefore never marks the form dirty / never autosaves.
		const body = "# Fresh Doc\n\nSome **bold** body text.";
		expect(isSameValue(body, body)).toBe(true);
		// A real edit changes the string → emit proceeds.
		expect(isSameValue(`${body} edited`, body)).toBe(false);
	});
});
