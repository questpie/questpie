import { describe, expect, it } from "bun:test";

import {
	assertCrdtFieldEligibility,
	getCrdtFieldEligibilityIssues,
} from "#questpie/server/fields/crdt.js";
import { text } from "#questpie/server/modules/core/fields/text.js";
import { textarea } from "#questpie/server/modules/core/fields/textarea.js";

describe("CRDT field strategies", () => {
	it("stores immutable text and add-wins string-set markers", () => {
		const textBase = textarea().default("").required();
		const collaborativeText = textBase.crdt({ format: "text" });
		const setBase = text({ mode: "text" }).array().default([]).required();
		const collaborativeSet = setBase.crdt({
			format: "set",
			conflict: "add-wins",
		});

		expect(textBase._state.crdt).toBeUndefined();
		expect(collaborativeText._state.crdt).toEqual({ format: "text" });
		expect(collaborativeSet._state.crdt).toEqual({
			format: "set",
			conflict: "add-wins",
		});
		expect(collaborativeText).not.toBe(textBase);
		expect(collaborativeSet).not.toBe(setBase);
	});

	it("preserves the marker through legal builder call orders", () => {
		const before = textarea()
			.crdt({ format: "text" })
			.default("")
			.required()
			.label("Content")
			.access({ read: true, update: true });
		const after = textarea()
			.default("")
			.required()
			.label("Content")
			.access({ read: true, update: true })
			.crdt({ format: "text" });
		const setBefore = text({ mode: "text" })
			.crdt({ format: "set", conflict: "add-wins" })
			.array()
			.default([])
			.required();

		expect(before._state.crdt).toEqual({ format: "text" });
		expect(after._state.crdt).toEqual({ format: "text" });
		expect(setBefore._state.crdt).toEqual({
			format: "set",
			conflict: "add-wins",
		});
		expect(() => assertCrdtFieldEligibility(before)).not.toThrow();
		expect(() => assertCrdtFieldEligibility(after)).not.toThrow();
		expect(() => assertCrdtFieldEligibility(setBefore)).not.toThrow();
	});

	it("reports every unsupported v1 field shape fail-closed", () => {
		const cases = [
			textarea().crdt({ format: "text" }),
			textarea().default("seed").required().crdt({ format: "text" }),
			textarea().default("").required().localized().crdt({ format: "text" }),
			textarea().default("").required().array().crdt({ format: "text" }),
			textarea().default("").required().virtual().crdt({ format: "text" }),
			textarea().default("").required().inputFalse().crdt({ format: "text" }),
			textarea().default("").required().outputFalse().crdt({ format: "text" }),
			textarea()
				.default("")
				.required()
				.hooks({ beforeChange: (value) => value })
				.crdt({ format: "text" }),
			textarea().default("").required().min(1).crdt({ format: "text" }),
			textarea()
				.default("")
				.required()
				.zod((schema) => schema)
				.crdt({ format: "text" }),
			textarea()
				.default("")
				.required()
				.fromDb((value) => value)
				.crdt({ format: "text" }),
			textarea()
				.default("")
				.required()
				.toDb((value) => value)
				.crdt({ format: "text" }),
			textarea()
				.default("")
				.required()
				.drizzle((column) => column)
				.crdt({ format: "text" }),
			text().default("").required().crdt({ format: "text" }),
			text({ mode: "text" })
				.array()
				.default([])
				.required()
				.crdt({ format: "text" }),
			text({ mode: "text" })
				.default("")
				.required()
				.crdt({ format: "set", conflict: "add-wins" }),
			text()
				.array()
				.default([])
				.required()
				.crdt({ format: "set", conflict: "add-wins" }),
		];

		for (const field of cases) {
			expect(getCrdtFieldEligibilityIssues(field).length).toBeGreaterThan(0);
			expect(() => assertCrdtFieldEligibility(field)).toThrow(
				"Invalid QUESTPIE CRDT field",
			);
		}
	});

	it("accepts exactly unbounded text and unrefined string sets", () => {
		const fields = [
			textarea().default("").required().crdt({ format: "text" }),
			text({ mode: "text" }).default("").required().crdt({ format: "text" }),
			text({ mode: "text" })
				.array()
				.default([])
				.required()
				.crdt({ format: "set", conflict: "add-wins" }),
		];

		for (const field of fields) {
			expect(getCrdtFieldEligibilityIssues(field)).toEqual([]);
		}
	});
});
