/**
 * Visual Edit keyboard helpers — pure-predicate tests.
 *
 * Drives `isEditableElement` against a tiny shape that mimics the
 * subset of `Element` the predicate inspects, so we can run
 * without a DOM.
 */

import { describe, expect, it } from "bun:test";

import { isEditableElement } from "#questpie/admin/client/components/visual-edit/keyboard";

type FakeElement = {
	tagName: string;
	type?: string;
	getAttribute?: (name: string) => string | null;
};

function el(
	tagName: string,
	extras?: Partial<FakeElement>,
): FakeElement {
	return {
		tagName,
		getAttribute: () => null,
		...extras,
	};
}

describe("isEditableElement — null safety", () => {
	it("treats null and undefined as non-editable", () => {
		expect(isEditableElement(null)).toBe(false);
		expect(isEditableElement(undefined)).toBe(false);
	});

	it("treats elements without a tagName as non-editable", () => {
		expect(
			isEditableElement({ tagName: "" } as unknown as Element),
		).toBe(false);
	});
});

describe("isEditableElement — text-input surfaces", () => {
	it("flags textarea as editable", () => {
		expect(
			isEditableElement(el("TEXTAREA") as unknown as Element),
		).toBe(true);
	});

	it("flags select as editable (Esc clears the listbox natively)", () => {
		expect(
			isEditableElement(el("SELECT") as unknown as Element),
		).toBe(true);
	});

	it("flags an unspecified input as editable (defaults to text)", () => {
		expect(
			isEditableElement(el("INPUT") as unknown as Element),
		).toBe(true);
	});

	it("flags text-like input types as editable", () => {
		for (const type of [
			"text",
			"email",
			"password",
			"search",
			"url",
			"number",
			"tel",
			"date",
		]) {
			expect(
				isEditableElement(el("INPUT", { type }) as unknown as Element),
			).toBe(true);
		}
	});
});

describe("isEditableElement — non-text inputs", () => {
	it("does NOT flag checkbox / radio / button / file as editable", () => {
		for (const type of [
			"checkbox",
			"radio",
			"button",
			"submit",
			"reset",
			"image",
			"file",
		]) {
			expect(
				isEditableElement(el("INPUT", { type }) as unknown as Element),
			).toBe(false);
		}
	});

	it("respects type case-insensitively", () => {
		expect(
			isEditableElement(
				el("INPUT", { type: "CHECKBOX" }) as unknown as Element,
			),
		).toBe(false);
	});
});

describe("isEditableElement — contenteditable", () => {
	function withContentEditable(value: string | null): FakeElement {
		return {
			tagName: "DIV",
			getAttribute: (name) =>
				name === "contenteditable" ? value : null,
		};
	}

	it("flags contenteditable=true as editable", () => {
		expect(
			isEditableElement(
				withContentEditable("true") as unknown as Element,
			),
		).toBe(true);
	});

	it("flags empty contenteditable attribute as editable", () => {
		expect(
			isEditableElement(
				withContentEditable("") as unknown as Element,
			),
		).toBe(true);
	});

	it("flags contenteditable=plaintext-only as editable", () => {
		expect(
			isEditableElement(
				withContentEditable("plaintext-only") as unknown as Element,
			),
		).toBe(true);
	});

	it("does NOT flag contenteditable=false / null as editable", () => {
		expect(
			isEditableElement(
				withContentEditable("false") as unknown as Element,
			),
		).toBe(false);
		expect(
			isEditableElement(
				withContentEditable(null) as unknown as Element,
			),
		).toBe(false);
	});
});

describe("isEditableElement — non-editable surfaces", () => {
	it("does NOT flag normal divs / spans as editable", () => {
		expect(
			isEditableElement(el("DIV") as unknown as Element),
		).toBe(false);
		expect(
			isEditableElement(el("SPAN") as unknown as Element),
		).toBe(false);
		expect(
			isEditableElement(el("BUTTON") as unknown as Element),
		).toBe(false);
	});
});
