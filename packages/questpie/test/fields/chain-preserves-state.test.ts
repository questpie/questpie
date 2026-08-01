/**
 * A field's chain methods must carry the field's state forward.
 *
 * `upload().multiple()` did not. It spread `f._` instead of `f._state`, and
 * `Field._` is `declare readonly _: TState` (field-class.ts:75) — a type-only
 * phantom with no runtime property. Spreading it yields nothing, so the
 * returned field lost its type, its metadata, its target collection and every
 * flag, keeping only the five keys `multiple` set inline.
 *
 * The type tests could not catch it. `upload().multiple()` is declared `(): any`
 * for reasons documented in field-inference.test-d.ts, so at the type level the
 * state does appear preserved — which is exactly what the contract test asserted
 * in a comment while the runtime disagreed. This file is the runtime half.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { upload } from "../../src/server/modules/core/fields/upload.js";

describe("upload().multiple() preserves field state", () => {
	it("keeps the field's identity", () => {
		const single = upload();
		const multi = (single as any).multiple();

		expect((single as any).getType()).toBe("upload");
		expect((multi as any).getType()).toBe("upload");
	});

	it("keeps the metadata, including the upload target", () => {
		const multi = (upload() as any).multiple();
		const meta = (multi as any).getMetadata();

		expect(meta.isUpload).toBe(true);
		expect(meta.targetCollection).toBe("assets");
		expect(meta.type).toBe("relation");
	});

	it("still applies its own overrides on top", () => {
		const multi = (upload() as any).multiple();

		// These are what `multiple` is FOR — they must win over the base state.
		expect(multi._state.multiple).toBe(true);
		expect(multi._state.columnFactory).toBeTypeOf("function");
	});

	it("owns a jsonb column rather than going virtual", () => {
		const multi = (upload() as any).multiple();

		// The array has to live somewhere. `through` is the form with no column
		// of its own, and this is not it. relation().multiple() does the same.
		expect(multi._state.virtual).toBe(false);
		expect(multi._state.columnFactory("gallery").config.columnType).toBe(
			"PgJsonb",
		);
	});

	it("stays virtual when the upload goes through a junction", () => {
		const m2m = (upload({ through: "post_assets" }) as any).multiple();

		expect(m2m._state.virtual).toBe(true);
	});

	it("can be localized, which virtual fields cannot", () => {
		// _inferLocation() tests `virtual` before `localized`, so while this was
		// virtual, .localized() parsed, typechecked and did nothing.
		const multi = (upload() as any).multiple().localized();

		expect(multi._state.localized).toBe(true);
		expect(multi._state.virtual).toBe(false);
	});

	it("carries modifiers applied before it", () => {
		const multi = (upload().required() as any).multiple();

		expect(multi._state.notNull).toBe(true);
		expect((multi as any).getType()).toBe("upload");
	});
});

/**
 * The class-level guard. `_` and `_state` differ by one character and only one
 * of them exists at runtime, so this is a typo the type checker cannot see —
 * `f._` is typed as `TState` and spreading it typechecks perfectly.
 */
describe("no field module spreads the type-only phantom", () => {
	it("every builtin field spreads _state, never _", () => {
		const dir = join(import.meta.dir, "../../src/server/modules/core/fields");
		const offenders: string[] = [];

		for (const name of readdirSync(dir)) {
			if (!name.endsWith(".ts")) continue;
			const src = readFileSync(join(dir, name), "utf8");
			src.split("\n").forEach((line, i) => {
				// `...x._` not followed by another identifier character.
				if (/\.\.\.\s*[A-Za-z_$][\w$]*\._(?![\w$])/.test(line)) {
					offenders.push(`${name}:${i + 1}  ${line.trim()}`);
				}
			});
		}

		expect(offenders).toEqual([]);
	});
});
