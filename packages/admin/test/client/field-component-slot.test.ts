/**
 * A field may point at its own components without registering a new field type.
 *
 * Before `.admin({ components: … })`, a component was chosen by field TYPE: the
 * client registry maps "text" to one form component and one cell, so giving a
 * single field a different cell meant declaring a whole new field type. The
 * slot is a registry KEY rather than a component because `.admin()` is
 * serialized from the server through field introspection and cannot carry a
 * function.
 *
 * `resolveComponentSlot` is the precedence decision on its own, extracted so it
 * can be tested without rendering. The rule that matters most here is the last
 * one: an unknown key must resolve to undefined so the caller falls back to the
 * by-type component. Returning null/throwing would blank out a field over a
 * typo in a string.
 */
import { describe, expect, it } from "bun:test";

import { resolveComponentSlot } from "../../src/client/views/collection/field-context";

const StatusPill = (() => null) as any;
const TextField = (() => null) as any;
const registry = {
	custom: { "status-pill": StatusPill },
	fields: { text: TextField },
};

describe("resolveComponentSlot", () => {
	it("resolves a string slot from the custom registry", () => {
		expect(resolveComponentSlot("status-pill", registry)).toBe(StatusPill);
	});

	it("resolves a reference slot by its type", () => {
		expect(
			resolveComponentSlot({ type: "status-pill", props: {} }, registry),
		).toBe(StatusPill);
	});

	it("falls back to the fields registry when custom has no such key", () => {
		// A slot may also name a registered field type's component.
		expect(resolveComponentSlot("text", registry)).toBe(TextField);
	});

	it("prefers custom over fields for the same key", () => {
		const both = {
			custom: { text: StatusPill },
			fields: { text: TextField },
		};
		expect(resolveComponentSlot("text", both)).toBe(StatusPill);
	});

	it("returns undefined for an unknown key so the caller falls back", () => {
		// The important one: a typo must not blank the field out.
		expect(resolveComponentSlot("no-such-component", registry)).toBeUndefined();
	});

	it("returns undefined when there is no slot or no registry", () => {
		expect(resolveComponentSlot(undefined, registry)).toBeUndefined();
		expect(resolveComponentSlot("status-pill", undefined)).toBeUndefined();
		// A malformed reference is not a key.
		expect(resolveComponentSlot({ props: {} }, registry)).toBeUndefined();
	});
});
