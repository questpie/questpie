/**
 * Tests for the `/admin/reactive` `prop` request type — the server-side
 * counterpart of the layout escape-hatch:
 *
 *   v.collectionForm({
 *     fields: [
 *       { field: f.author, props: { filter: ({ data }) => ({ team: data.team }) } },
 *     ],
 *   })
 *
 * The function stays on the server; introspection emits a placeholder. The
 * client then calls batchReactive with `{ type: "prop", propPath: "filter" }`
 * and current form data, and the server resolves the original function.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection, isReactivePropPlaceholder } from "questpie";

import { reactiveFunctions } from "../../src/server/modules/admin/routes/reactive.js";
import { introspectCollection } from "../../../questpie/src/server/collection/introspection.js";
import { buildMockApp } from "../../../questpie/test/utils/mocks/mock-app-builder.js";
import { createTestContext } from "../../../questpie/test/utils/test-context.js";
import { runTestDbMigrations } from "../../../questpie/test/utils/test-db.js";

const users = collection("users").fields(({ f }) => ({
	name: f.text().required(),
	role: f.text(),
	team: f.text(),
}));

// We mimic what codegen would produce by stamping `adminForm` onto the
// builder state directly via `.set()`. This avoids depending on the full
// admin codegen + factories machinery in a unit test.
const advice_threads = collection("advice_threads")
	.fields(({ f }) => ({
		subject: f.text().required(),
		team: f.text(),
		// Field-level admin meta — filter as a function. Should be picked
		// up by the introspection walker AND by the reactive endpoint when
		// no layout-level override exists.
		counselorId: f
			.relation("users")
			.set("admin", {
				filter: ({ data }: any) => ({
					team: data.team,
					role: "field-default",
				}),
			}),
		mentorId: f.relation("users"),
		// A field with NO admin filter — used to verify the layout override
		// path independently of any field-level config.
		reviewerId: f.relation("users"),
	}))
	.set("adminForm", {
		view: "collection-form",
		fields: [
			"subject",
			"team",
			{
				field: "counselorId",
				props: {
					// Layout-level override — wins over field-level above.
					filter: ({ data }: any) => ({ team: data.team, role: "admin" }),
					// Static — should not require a network call.
					placeholder: "Pick an admin",
				},
			},
			{
				field: "mentorId",
				props: {
					// `{ handler, deps, debounce }` config
					filter: {
						handler: () => ({ role: "mentor" }),
						deps: ["team"],
						debounce: 200,
					},
				},
			},
			// reviewerId rendered without any layout override → resolution
			// should fall back to its field-level admin meta (none here →
			// no handler available).
			"reviewerId",
		],
	});

function makeRouteCtx(app: unknown, input: unknown) {
	return {
		app,
		db: (app as any).db,
		locale: "en",
		session: undefined,
		input,
		request: new Request("http://localhost/admin/reactive"),
	} as any;
}

describe("/admin/reactive — prop type", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: { users, advice_threads },
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("evaluates a function-valued layout prop with current form data", async () => {
		const result = await reactiveFunctions.batchReactive.handler(
			makeRouteCtx(setup.app, {
				collection: "advice_threads",
				type: "collection",
				formData: { team: "blue" },
				requests: [
					{ field: "counselorId", type: "prop", propPath: "filter" },
				],
			}),
		);

		expect(result.results).toHaveLength(1);
		const r = result.results[0]!;
		expect(r.error).toBeUndefined();
		expect(r.field).toBe("counselorId");
		expect(r.type).toBe("prop");
		expect(r.propPath).toBe("filter");
		expect(r.value).toEqual({ team: "blue", role: "admin" });
	});

	it("falls back to field-level `.admin({ filter })` when no layout override", async () => {
		// reviewerId has no layout `props`, so resolution must land on the
		// field's own admin meta. reviewerId itself has no filter; counselorId
		// has both, layout wins. Build a fresh collection where the only
		// source is field-level so we get a deterministic answer.
		const cleanup = setup.cleanup;
		await cleanup();

		const fieldOnlyUsers = collection("users").fields(({ f }) => ({
			name: f.text().required(),
			role: f.text(),
		}));
		const fieldOnlyThreads = collection("threads").fields(({ f }) => ({
			authorId: f
				.relation("users")
				.set("admin", {
					filter: ({ data }: any) => ({ scope: data.subject ?? "default" }),
				}),
			subject: f.text(),
		}));

		setup = await buildMockApp({
			collections: { users: fieldOnlyUsers, threads: fieldOnlyThreads },
		});
		await runTestDbMigrations(setup.app);

		const result = await reactiveFunctions.batchReactive.handler(
			makeRouteCtx(setup.app, {
				collection: "threads",
				type: "collection",
				formData: { subject: "billing" },
				requests: [{ field: "authorId", type: "prop", propPath: "filter" }],
			}),
		);

		const r = result.results[0]!;
		expect(r.error).toBeUndefined();
		expect(r.value).toEqual({ scope: "billing" });
	});

	it("layout `props.filter` overrides field-level `.admin({ filter })`", async () => {
		// counselorId has BOTH a field-level filter (role: "field-default")
		// and a layout-level filter (role: "admin"). The layout override
		// must win so per-instance customisation is possible.
		const result = await reactiveFunctions.batchReactive.handler(
			makeRouteCtx(setup.app, {
				collection: "advice_threads",
				type: "collection",
				formData: { team: "purple" },
				requests: [
					{ field: "counselorId", type: "prop", propPath: "filter" },
				],
			}),
		);

		const r = result.results[0]!;
		expect(r.error).toBeUndefined();
		expect(r.value).toEqual({ team: "purple", role: "admin" });
	});

	it("returns no-handler error when neither layout nor field defines the prop", async () => {
		// reviewerId has no admin meta at all — neither field nor layout
		// supplies a handler. Should error per-request, not 500 the batch.
		const result = await reactiveFunctions.batchReactive.handler(
			makeRouteCtx(setup.app, {
				collection: "advice_threads",
				type: "collection",
				formData: {},
				requests: [
					{ field: "reviewerId", type: "prop", propPath: "filter" },
				],
			}),
		);

		const r = result.results[0]!;
		expect(r.value).toBeUndefined();
		expect(r.error).toContain("filter");
	});

	it("evaluates a `{ handler, deps }` config prop", async () => {
		const result = await reactiveFunctions.batchReactive.handler(
			makeRouteCtx(setup.app, {
				collection: "advice_threads",
				type: "collection",
				formData: { team: "red" },
				requests: [
					{ field: "mentorId", type: "prop", propPath: "filter" },
				],
			}),
		);

		const r = result.results[0]!;
		expect(r.error).toBeUndefined();
		expect(r.value).toEqual({ role: "mentor" });
	});

	it("returns an explanatory error when propPath is missing", async () => {
		const result = await reactiveFunctions.batchReactive.handler(
			makeRouteCtx(setup.app, {
				collection: "advice_threads",
				type: "collection",
				formData: {},
				requests: [
					// No propPath — should error per-request, not 500 the batch
					{ field: "counselorId", type: "prop" },
				],
			}),
		);

		const r = result.results[0]!;
		expect(r.value).toBeUndefined();
		expect(r.error).toContain("propPath is required");
	});

	it("returns an explanatory error when the prop key has no handler on the layout", async () => {
		const result = await reactiveFunctions.batchReactive.handler(
			makeRouteCtx(setup.app, {
				collection: "advice_threads",
				type: "collection",
				formData: {},
				requests: [
					{ field: "counselorId", type: "prop", propPath: "placeholder" },
				],
			}),
		);

		// `placeholder` is a static string — no handler to resolve it.
		const r = result.results[0]!;
		expect(r.value).toBeUndefined();
		expect(r.error).toContain("placeholder");
	});

	it("introspection emits ReactivePropPlaceholder in place of function-valued layout props", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const collectionDef = (setup.app as any).getCollections()
			.advice_threads;
		const schema = await introspectCollection(
			collectionDef,
			{ session: ctx.session, db: setup.app.db, locale: "en" },
			setup.app as any,
		);

		const fields = (schema as any)?.admin?.form?.fields as unknown[];
		expect(Array.isArray(fields)).toBe(true);

		const counselor = fields.find(
			(f: any) => typeof f === "object" && f.field === "counselorId",
		) as any;
		expect(counselor).toBeDefined();
		// Function `filter` → placeholder
		expect(isReactivePropPlaceholder(counselor.props.filter)).toBe(true);
		expect(counselor.props.filter.watch).toContain("team");
		// Static `placeholder` → unchanged
		expect(counselor.props.placeholder).toBe("Pick an admin");

		const mentor = fields.find(
			(f: any) => typeof f === "object" && f.field === "mentorId",
		) as any;
		expect(isReactivePropPlaceholder(mentor.props.filter)).toBe(true);
		expect(mentor.props.filter.watch).toEqual(["team"]); // explicit deps
		expect(mentor.props.filter.debounce).toBe(200);
	});

	it("introspection emits ReactivePropPlaceholder in place of function-valued field-level admin meta", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const collectionDef = (setup.app as any).getCollections()
			.advice_threads;
		const schema = await introspectCollection(
			collectionDef,
			{ session: ctx.session, db: setup.app.db, locale: "en" },
			setup.app as any,
		);

		// Field-level `.set("admin", { filter: fn })` lands on
		// `metadata.meta.filter` — should now be a placeholder.
		const counselorMeta = (schema as any).fields?.counselorId?.metadata
			?.meta;
		expect(counselorMeta).toBeDefined();
		expect(isReactivePropPlaceholder(counselorMeta.filter)).toBe(true);
		expect(counselorMeta.filter.watch).toContain("team");
	});

	it("co-exists with classical (hidden/compute) reactive types in one batch", async () => {
		const result = await reactiveFunctions.batchReactive.handler(
			makeRouteCtx(setup.app, {
				collection: "advice_threads",
				type: "collection",
				formData: { team: "green" },
				requests: [
					// New prop type
					{ field: "counselorId", type: "prop", propPath: "filter" },
					// Existing compute type — no handler for this field, but the
					// dispatcher should still respond per-request
					{ field: "subject", type: "compute" },
				],
			}),
		);

		expect(result.results).toHaveLength(2);
		const propResult = result.results.find((r: any) => r.type === "prop");
		const computeResult = result.results.find(
			(r: any) => r.type === "compute",
		);
		expect(propResult?.value).toEqual({ team: "green", role: "admin" });
		expect(computeResult?.error).toContain("compute handler");
	});
});
