/**
 * Per-Operation Access Rule Type Tests (P0 — infer-first map)
 *
 * Compile-time only — run with: tsc --noEmit
 *
 * Verifies that `.access()` threads Select/Insert/Update generics the same
 * way `.hooks()` does:
 * - create: `ctx.input` is the raw insert input (pre-validation), no row
 * - update: `ctx.data` is the existing row (NON-optional), `ctx.input` the patch
 * - delete/transition: `ctx.data` is the existing row (NON-optional)
 * - read: rules can return a typed AccessWhere over the row fields
 *
 * Also verifies the sanctioned shared-helper pattern: a helper typed with
 * `AccessContext<TDoc>` is accepted by the collection that describes it
 * (jubli regression — helpers used to hand-roll structural ctx types).
 */

import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import type {
	AccessContext,
	CollectionAccess,
	RowAccessRule,
} from "#questpie/server/collection/builder/types.js";
import { GlobalBuilder } from "#questpie/server/global/builder/global-builder.js";

import type { Equal, Expect, Extends } from "./type-test-utils.js";

// ============================================================================
// Fixture
// ============================================================================

const posts = collection("posts").fields(({ f }) => ({
	title: f.text(255).required(),
	authorId: f.text(64).required(),
	views: f.number().default(0),
}));

type PostSelect = typeof posts.$infer.select;
type PostInsert = typeof posts.$infer.insert;
type PostUpdate = typeof posts.$infer.update;

// ============================================================================
// update — ctx.data is the existing row (non-optional), ctx.input the patch
// ============================================================================

posts.access({
	update: (ctx) => {
		// data is NON-optional for update (row is always loaded before the rule)
		type _dataIsRow = Expect<Equal<typeof ctx.data, PostSelect>>;
		// input is the typed patch — optional chaining, no isRecord() dance
		type _inputIsPatch = Expect<
			Equal<typeof ctx.input, PostUpdate | undefined>
		>;
		return ctx.data.authorId === "me" && ctx.input?.title !== "";
	},
});

// ============================================================================
// create — ctx.input is the raw insert input, no row exists yet
// ============================================================================

posts.access({
	create: (ctx) => {
		type _noRow = Expect<Equal<typeof ctx.data, undefined>>;
		type _inputIsInsert = Expect<
			Equal<typeof ctx.input, PostInsert | undefined>
		>;
		return ctx.input?.title !== "forbidden";
	},
});

// ============================================================================
// delete / transition — ctx.data is the existing row (non-optional)
// ============================================================================

posts.access({
	delete: (ctx) => {
		type _dataIsRow = Expect<Equal<typeof ctx.data, PostSelect>>;
		return ctx.data.authorId === "me";
	},
	transition: (ctx) => {
		type _dataIsRow = Expect<Equal<typeof ctx.data, PostSelect>>;
		return true;
	},
});

// ============================================================================
// read — returning a typed AccessWhere over row fields
// ============================================================================

posts.access({
	read: ({ session: _session }) => ({ authorId: "me" }),
});

// boolean rules still work for every operation
posts.access({
	read: true,
	create: false,
	update: true,
	delete: false,
});

// ============================================================================
// Shared helper pattern — AccessContext<TDoc> param (the sanctioned one-liner)
// ============================================================================

// A shared rule helper in lib/ — zero hand-rolled structural types.
function isAuthor(ctx: AccessContext<PostSelect>): boolean {
	return ctx.data?.authorId === "owner";
}

posts.access({
	// update ctx (data non-optional) is assignable to the helper's wider ctx
	update: (ctx) => isAuthor(ctx),
	// read ctx works too — data is optional on the helper param
	read: (ctx) => isAuthor(ctx),
});

// Old-style annotated rules (pre-3.6 style) keep compiling: a function typed
// against the bare AccessContext<TDoc> is assignable to every rule slot.
const legacyRule = (ctx: AccessContext<PostSelect>) => !!ctx.data;
posts.access({ update: legacyRule, delete: legacyRule, read: legacyRule });

// RowAccessRule is exported and matches the update/delete slot shape
type UpdateSlot = NonNullable<
	CollectionAccess<PostSelect, PostInsert, PostUpdate>["update"]
>;
type _updateIsRowRule = Expect<
	Extends<RowAccessRule<PostSelect, PostSelect, PostUpdate>, UpdateSlot>
>;

// ============================================================================
// Field-level rules — slim runtime-honest ctx ({ req, user, doc, operation })
// ============================================================================

posts.access({
	fields: {
		views: {
			read: (ctx) => {
				type _docIsRow = Expect<Equal<typeof ctx.doc, PostSelect | undefined>>;
				type _op = Expect<
					Equal<typeof ctx.operation, "create" | "read" | "update" | "delete">
				>;
				return ctx.doc?.authorId === "me";
			},
			update: false,
		},
	},
});

// ============================================================================
// Globals — .access() threads Select/Update the same way
// ============================================================================

const settings = GlobalBuilder.create("settings").fields(({ f }) => ({
	siteName: f.text(255).required(),
	maintenance: f.boolean().default(false),
}));

type SettingsSelect = typeof settings.$infer.select;
type SettingsUpdate = typeof settings.$infer.update;

settings.access({
	update: (ctx) => {
		// global may not exist yet on first write — data stays optional
		type _data = Expect<Equal<typeof ctx.data, SettingsSelect | undefined>>;
		type _input = Expect<Equal<typeof ctx.input, SettingsUpdate | undefined>>;
		return ctx.data?.maintenance !== true;
	},
	read: (ctx) => {
		type _data = Expect<Equal<typeof ctx.data, SettingsSelect | undefined>>;
		return true;
	},
});
