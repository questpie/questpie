/**
 * CL-15 — Lifecycle-hook ctx is self-documenting (A1).
 *
 * `afterChange` ctx is a DISCRIMINATED UNION on `operation`:
 *   - operation "create" ⇒ `original` is absent (`undefined`)
 *   - operation "update" ⇒ `original` is the previous row (`TSelect`, non-optional)
 * Previously `original` was `TSelect | undefined` on BOTH ops, contradicting the
 * JSDoc ("only on update") and the runtime (create omits it).
 *
 * `afterDelete` ctx `data` AND `original` are the deleted row (`TSelect`) — the
 * type previously declared `original: never` while the runtime populates it.
 *
 * Asserted three ways: (1) the param a user's hook receives directly, (2) the
 * same type flowing through the `CollectionHooks` seam, and (3) end-to-end
 * through a real `collection(...).hooks(...)` so the discrimination survives
 * `.hooks()` inference (the spec's stated risk).
 */

import type {
	Equal,
	Expect,
	HasKey,
	IsOptional,
	IsRequired,
	NoAny,
} from "../_assert.js";

import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import type {
	AfterChangeHook,
	AfterDeleteHook,
	CollectionHooks,
} from "#questpie/server/collection/builder/types.js";

type Row = { id: string; title: string; status: string };

// ============================================================================
// (1) afterChange — the param a user's callback receives is discriminated.
// ============================================================================

type ACCtx = Parameters<AfterChangeHook<Row>>[0];
type ACCreate = Extract<ACCtx, { operation: "create" }>;
type ACUpdate = Extract<ACCtx, { operation: "update" }>;

// create: `original` is absent (undefined + optional), `operation` is the literal.
type _ac_create_op = Expect<Equal<ACCreate["operation"], "create">>;
type _ac_create_original_undefined = Expect<Equal<ACCreate["original"], undefined>>;
type _ac_create_original_optional = Expect<IsOptional<ACCreate, "original">>;

// update: `original` is the non-optional previous row.
type _ac_update_op = Expect<Equal<ACUpdate["operation"], "update">>;
type _ac_update_original_row = Expect<Equal<ACUpdate["original"], Row>>;
type _ac_update_original_required = Expect<IsRequired<ACUpdate, "original">>;

// `data` is the full record on both arms.
type _ac_create_data = Expect<Equal<ACCreate["data"], Row>>;
type _ac_update_data = Expect<Equal<ACUpdate["data"], Row>>;

// ============================================================================
// (2) The same discrimination flows through the `CollectionHooks` seam — this
// is the type `.hooks({ afterChange })` contextually applies to the callback.
// ============================================================================

type ViaHooks = Parameters<
	Extract<NonNullable<CollectionHooks<Row>["afterChange"]>, (...a: any[]) => any>
>[0];
type _viahooks_equal = Expect<Equal<ViaHooks, ACCtx>>;

// ============================================================================
// (3) afterDelete — `data` and `original` are both the deleted row.
// ============================================================================

type ADCtx = Parameters<AfterDeleteHook<Row>>[0];
type _ad_op = Expect<Equal<ADCtx["operation"], "delete">>;
type _ad_data_row = Expect<Equal<ADCtx["data"], Row>>;
type _ad_original_row = Expect<Equal<ADCtx["original"], Row>>;
type _ad_original_required = Expect<IsRequired<ADCtx, "original">>;

// ============================================================================
// (4) End-to-end through a real builder chain: the discrimination must survive
// `.hooks()` inference with the collection's concrete inferred row type.
// ============================================================================

collection("hook_ctx_probe")
	.fields(({ f }) => ({
		title: f.text().required(),
		status: f.text(),
	}))
	.hooks({
		afterChange: (ctx) => {
			// `operation` is the discriminant union.
			type _op = Expect<Equal<typeof ctx.operation, "create" | "update">>;
			if (ctx.operation === "create") {
				// create arm: `original` narrows to absent.
				type _create_original = Expect<Equal<typeof ctx.original, undefined>>;
			} else {
				// update arm: `original` is the concrete inferred row, not `any`.
				type _update_notAny = Expect<NoAny<typeof ctx.original>>;
				type _update_hasTitle = Expect<HasKey<typeof ctx.original, "title">>;
			}
			// `data` is always the concrete inferred row.
			type _data_hasTitle = Expect<HasKey<typeof ctx.data, "title">>;
		},
		afterDelete: (ctx) => {
			type _del_op = Expect<Equal<typeof ctx.operation, "delete">>;
			// The deleted row is available (concrete, not `any`) on both keys.
			type _del_original_notAny = Expect<NoAny<typeof ctx.original>>;
			type _del_original_hasTitle = Expect<HasKey<typeof ctx.original, "title">>;
			type _del_data_hasTitle = Expect<HasKey<typeof ctx.data, "title">>;
		},
	});
