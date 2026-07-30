/**
 * Calling `.validation()` must not change WHICH fields a collection validates.
 *
 * `state.validation` is built two different ways. When the optional
 * `.validation()` builder method is never called, the Collection constructor
 * fills it in (collection.ts) from `state.fields` — the real Drizzle columns —
 * and deliberately adds the system columns on top: `defaultIdColumn()` when the
 * user did not declare an id, `timestampsCols()` unless timestamps are off, and
 * `softDeleteCols()` when soft delete is on. The comments there say why: so a
 * custom id can be passed on create, and so internal operations like restore can
 * write `deletedAt`.
 *
 * The `.validation()` path (collection-builder.ts) instead walks
 * `state.fieldDefinitions` and adds none of those three. Both paths end in a
 * Zod object, which strips unknown keys rather than rejecting them — so the
 * difference is silent. Passing `{ exclude }` or `{ refine }`, or calling
 * `.validation()` with no arguments at all, quietly removed the ability to
 * supply an id on create and to write `deletedAt` on restore.
 *
 * The two paths also disagreed on how a field is classified as localized: the
 * constructor reads the `state.localized` set, `.validation()` asks
 * `fieldDef.getLocation() === "i18n"`. That is the same divergence recorded in
 * the field-location classifier note, and it decides whether a field lands in
 * the main schema or the i18n one.
 *
 * Asserting parity rather than a fixed key list on purpose: the point is that
 * an optional builder call cannot change the validated surface, not that the
 * surface has a particular shape today.
 */
import { describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";

const FIELDS = ({ f }: any) => ({
	title: f.text(200),
	body: f.textarea(),
});

const keysOf = (entity: any, which: "insertSchema" | "updateSchema") => {
	const schema = entity.state.validation?.[which];
	expect(schema).toBeDefined();
	return Object.keys(schema.shape).sort();
};

describe("validation schema parity across the two build paths", () => {
	it("keeps the same insert keys whether or not .validation() is called", () => {
		const auto = collection("vp_posts").fields(FIELDS).build();
		const explicit = collection("vp_posts").fields(FIELDS).validation().build();

		expect(keysOf(explicit, "insertSchema")).toEqual(
			keysOf(auto, "insertSchema"),
		);
	});

	it("keeps the same update keys whether or not .validation() is called", () => {
		const auto = collection("vp_posts_u").fields(FIELDS).build();
		const explicit = collection("vp_posts_u")
			.fields(FIELDS)
			.validation()
			.build();

		expect(keysOf(explicit, "updateSchema")).toEqual(
			keysOf(auto, "updateSchema"),
		);
	});

	it("accepts a custom id on create after .validation()", () => {
		// The constructor adds `defaultIdColumn()` precisely so this works; the
		// .validation() path dropped it, and the Zod object stripped the id
		// instead of complaining.
		const explicit = collection("vp_ids").fields(FIELDS).validation().build();

		const parsed = explicit.state.validation.insertSchema.parse({
			id: "00000000-0000-4000-8000-000000000001",
			title: "hello",
		});
		expect(parsed.id).toBe("00000000-0000-4000-8000-000000000001");
	});

	it("accepts deletedAt on update after .validation() when soft delete is on", () => {
		// This is the restore path: it writes `deletedAt: null`. Stripped, restore
		// updates nothing and silently no-ops.
		const explicit = collection("vp_soft")
			.fields(FIELDS)
			.options({ softDelete: true })
			.validation()
			.build();

		const parsed = explicit.state.validation.updateSchema.parse({
			deletedAt: null,
		});
		expect(parsed).toHaveProperty("deletedAt");
	});

	it("routes localized fields the same way in both paths", () => {
		const localizedFields = ({ f }: any) => ({
			title: f.text(200).localized(),
			slug: f.text(200),
		});

		const auto = collection("vp_i18n").fields(localizedFields).build();
		const explicit = collection("vp_i18n")
			.fields(localizedFields)
			.validation()
			.build();

		expect(keysOf(explicit, "insertSchema")).toEqual(
			keysOf(auto, "insertSchema"),
		);
		expect(
			Object.keys(explicit.state.validation.i18nInsertSchema?.shape ?? {}),
		).toEqual(Object.keys(auto.state.validation.i18nInsertSchema?.shape ?? {}));
	});
});
