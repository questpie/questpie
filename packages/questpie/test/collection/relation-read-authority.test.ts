import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";

import { collection } from "../../src/exports/index.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createMockSession, createTestContext } from "../utils/test-context";
import { createTestDb, runTestDbMigrations } from "../utils/test-db";

let hiddenReadCalls = 0;
let visibleBeforeReadCalls = 0;
let parentPolicy: Record<string, unknown> | true = true;
let junctionRead: boolean | Record<string, unknown> = true;
const gatedInputs: unknown[] = [];

const childOf = (f: any) =>
	f.relation("rra_parents").required().relationName("parent");
const many = (f: any, target: string) =>
	f.relation(target).hasMany({ foreignKey: "parent", relationName: "parent" });

const parents = collection("rra_parents")
	.fields(({ f }: any) => ({
		name: f.text().required(),
		hidden: many(f, "rra_hidden"),
		scoped: many(f, "rra_scoped"),
		visible: many(f, "rra_visible"),
		localized: many(f, "rra_localized"),
		owner: f.relation("rra_owners"),
		tags: f.relation("rra_tags").manyToMany({
			through: "rra_parent_tags",
			sourceField: "parent",
			targetField: "tag",
		}),
		labels: f.relation("rra_labels").manyToMany({
			through: "rra_parent_labels",
			sourceField: "parent",
			targetField: "label",
		}),
		keyHidden: many(f, "rra_key_hidden"),
		cover: f.upload({ to: "rra_files" }),
		gallery: f.upload({
			to: "rra_files",
			through: "rra_parent_files",
			sourceField: "parent",
			targetField: "file",
		}),
		gated: many(f, "rra_gated"),
		topics: f.relation("rra_topics").manyToMany({
			through: "rra_parent_topics",
			sourceField: "parent",
			targetField: "topic",
		}),
	}))
	.access({ read: () => parentPolicy });

const hidden = collection("rra_hidden")
	.fields(({ f }: any) => ({
		secret: f.text().required(),
		parent: childOf(f),
	}))
	.access({
		read: () => {
			hiddenReadCalls++;
			return false;
		},
	});

const scoped = collection("rra_scoped")
	.fields(({ f }: any) => ({
		tenant: f.text().required(),
		secret: f.text().required(),
		parent: childOf(f),
	}))
	.options({ softDelete: true })
	.access({ read: () => ({ tenant: "t1" }) });

const visible = collection("rra_visible")
	.fields(({ f }: any) => ({
		name: f.text().required(),
		parent: childOf(f),
	}))
	.access({ read: true })
	.hooks({
		beforeRead: () => {
			visibleBeforeReadCalls++;
		},
	});

const localized = collection("rra_localized")
	.fields(({ f }: any) => ({
		rank: f.number().required(),
		label: f.text().localized(),
		parent: childOf(f),
	}))
	.access({ read: true });

const owners = collection("rra_owners")
	.fields(({ f }: any) => ({ name: f.text().required() }))
	.access({ read: false });

const tags = collection("rra_tags")
	.fields(({ f }: any) => ({ label: f.text().required() }))
	.access({ read: false });

const parentTags = collection("rra_parent_tags")
	.fields(({ f }: any) => ({
		parent: f.relation("rra_parents").required(),
		tag: f.relation("rra_tags").required(),
	}))
	.access({ read: true });

const labels = collection("rra_labels")
	.fields(({ f }: any) => ({ text: f.text().required() }))
	.access({ read: true });

const parentLabels = collection("rra_parent_labels")
	.fields(({ f }: any) => ({
		parent: f.relation("rra_parents").required(),
		label: f.relation("rra_labels").required(),
	}))
	.access({ read: () => junctionRead });

const keyHidden = collection("rra_key_hidden")
	.fields(({ f }: any) => ({ parent: childOf(f) }))
	.access({ read: true, fields: { parent: { read: false } } } as any);

const files = collection("rra_files")
	.fields(({ f }: any) => ({ alt: f.text() }))
	.upload({ visibility: "public" })
	.access({ read: false });

const parentFiles = collection("rra_parent_files")
	.fields(({ f }: any) => ({
		parent: f.relation("rra_parents").required(),
		file: f.relation("rra_files").required(),
	}))
	.access({ read: false });

const nodes = collection("rra_nodes")
	.fields(({ f }: any) => ({
		name: f.text().required(),
		visible: f.boolean().required(),
		up: f.relation("rra_nodes").relationName("up"),
		down: f
			.relation("rra_nodes")
			.hasMany({ foreignKey: "up", relationName: "up" }),
	}))
	.access({ read: () => ({ visible: true }) });

// A rule that branches on the concrete read it is asked about.
const gated = collection("rra_gated")
	.fields(({ f }: any) => ({
		status: f.text().required(),
		parent: childOf(f),
	}))
	.access({
		read: ({ input }: any) => {
			gatedInputs.push(input);
			return input?.where?.status?.eq === "public";
		},
	});

const topics = collection("rra_topics")
	.fields(({ f }: any) => ({
		name: f.text().required(),
		label: f.text().localized(),
		visible: f.boolean().required(),
		links: f.relation("rra_parent_topics").hasMany({
			foreignKey: "topic",
			relationName: "topic",
		}),
	}))
	.access({ read: () => ({ visible: true }) });

const parentTopics = collection("rra_parent_topics")
	.fields(({ f }: any) => ({
		parent: f.relation("rra_parents").required(),
		topic: f.relation("rra_topics").required(),
	}))
	.access({ read: () => junctionRead });

// Both sides localized: a bare `label` inside a relation subquery would bind
// to the PARENT's translation.
const localizedParents = collection("rra_lparents")
	.fields(({ f }: any) => ({
		label: f.text().localized(),
		kids: f
			.relation("rra_lkids")
			.hasMany({ foreignKey: "parent", relationName: "parent" }),
	}))
	.access({ read: true });

const localizedKids = collection("rra_lkids")
	.fields(({ f }: any) => ({
		label: f.text().localized(),
		parent: f.relation("rra_lparents").required().relationName("parent"),
	}))
	.access({ read: () => ({ label: { eq: "public" } }) });

const statements: string[] = [];

describe("relation reads honour the target collection's read access", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let client: Awaited<ReturnType<typeof createTestDb>>;
	let c: any;
	const system = createTestContext({ accessMode: "system" });
	const user = createTestContext({
		accessMode: "user",
		session: createMockSession(),
	});
	const ids: Record<string, string> = {};

	const names = (result: { docs: Array<{ name: string }> }) =>
		result.docs.map((doc) => doc.name).sort();
	const findNames = async (where: unknown, context = user) =>
		names(await c.rra_parents.find({ where }, context));
	const countWhere = (where: unknown, context = user) =>
		c.rra_parents.count({ where }, context);
	const targetStatements = (table: string) =>
		statements.filter((statement) => statement.includes(`"${table}"`));

	beforeAll(async () => {
		client = await createTestDb();
		const query = client.query.bind(client);
		(client as any).query = (statement: string, ...rest: any[]) => {
			statements.push(statement);
			return (query as any)(statement, ...rest);
		};
		setup = await buildMockApp(
			{
				collections: {
					rra_parents: parents,
					rra_hidden: hidden,
					rra_scoped: scoped,
					rra_visible: visible,
					rra_localized: localized,
					rra_owners: owners,
					rra_tags: tags,
					rra_parent_tags: parentTags,
					rra_labels: labels,
					rra_parent_labels: parentLabels,
					rra_key_hidden: keyHidden,
					rra_files: files,
					rra_parent_files: parentFiles,
					rra_nodes: nodes,
					rra_gated: gated,
					rra_topics: topics,
					rra_parent_topics: parentTopics,
					rra_lparents: localizedParents,
					rra_lkids: localizedKids,
				},
			},
			{ db: { pglite: client } as any },
		);
		await runTestDbMigrations(setup.app);
		c = setup.app.collections;

		const owner = await c.rra_owners.create({ name: "o1" }, system);
		await setup.app.storage.upload(
			"uploads/cover.png",
			new TextEncoder().encode("cover"),
		);
		const cover = await c.rra_files.create(
			{
				key: "uploads/cover.png",
				filename: "cover.png",
				mimeType: "image/png",
				size: 1,
				visibility: "public",
			},
			system,
		);
		const red = await c.rra_tags.create({ label: "red" }, system);
		const blue = await c.rra_labels.create({ text: "blue" }, system);
		for (const name of ["A", "B"]) {
			const parent = await c.rra_parents.create(
				{
					name,
					owner: name === "A" ? owner.id : null,
					cover: name === "A" ? cover.id : null,
				},
				system,
			);
			ids[name] = parent.id;
			await c.rra_parent_files.create(
				{ parent: parent.id, file: cover.id },
				system,
			);
			await c.rra_key_hidden.create({ parent: parent.id }, system);
			await c.rra_gated.create(
				{ status: name === "A" ? "public" : "private", parent: parent.id },
				system,
			);
			await c.rra_hidden.create(
				{ secret: name === "A" ? "alpha" : "beta", parent: parent.id },
				system,
			);
			// A: visible "y", tenant-hidden "x". B: visible "x", tenant-hidden "y".
			const [visibleSecret, hiddenSecret] =
				name === "A" ? ["y", "x"] : ["x", "y"];
			await c.rra_scoped.create(
				{ tenant: "t1", secret: visibleSecret, parent: parent.id },
				system,
			);
			await c.rra_scoped.create(
				{ tenant: "t2", secret: hiddenSecret, parent: parent.id },
				system,
			);
			for (const n of [1, 2, 3]) {
				await c.rra_visible.create(
					{ name: `${name}${n}`, parent: parent.id },
					system,
				);
			}
			if (name === "A") {
				await c.rra_parent_tags.create(
					{ parent: parent.id, tag: red.id },
					system,
				);
				await c.rra_parent_labels.create(
					{ parent: parent.id, label: blue.id },
					system,
				);
			}
		}
		const root = await c.rra_nodes.create({ name: "R", visible: true }, system);
		for (const [name, visible] of [
			["a-hidden", false],
			["b", true],
			["c", true],
		] as const) {
			await c.rra_nodes.create({ name, visible, up: root.id }, system);
		}
		const topic: Record<string, string> = {};
		for (const [name, visible] of [
			["t-a", true],
			["t-b", false],
			["t-c", true],
			["t-d", true],
		] as const) {
			topic[name] = (
				await c.rra_topics.create(
					{ name, label: `${name}-en`, visible },
					system,
				)
			).id;
		}
		await c.rra_topics.updateById(
			{ id: topic["t-a"], data: { label: "t-a-sk" } },
			{ ...system, locale: "sk" },
		);
		for (const [parent, name] of [
			["A", "t-b"],
			["A", "t-c"],
			["A", "t-a"],
			["B", "t-a"],
			["B", "t-d"],
		] as const) {
			await c.rra_parent_topics.create(
				{ parent: ids[parent], topic: topic[name] },
				system,
			);
		}
		for (const [parentLabel, kidLabel] of [
			["public", "secret"],
			["other", "public"],
		]) {
			const parent = await c.rra_lparents.create(
				{ label: parentLabel },
				system,
			);
			await c.rra_lkids.create({ label: kidLabel, parent: parent.id }, system);
		}
		// A deleted, tenant-visible child sorts first for A and must be skipped.
		const deleted = await c.rra_scoped.create(
			{ tenant: "t1", secret: "a-deleted", parent: ids.A },
			system,
		);
		await c.rra_scoped.deleteById({ id: deleted.id }, system);
		for (const [name, rank, en, sk] of [
			["A", 1, "a1-en", "a1-sk"],
			["A", 2, "a2-en", null],
			["B", 1, "b1-en", "b1-sk"],
		] as const) {
			const row = await c.rra_localized.create(
				{ rank, label: en, parent: ids[name] },
				{ ...system, locale: "en" },
			);
			if (sk) {
				await c.rra_localized.updateById(
					{ id: row.id, data: { label: sk } },
					{ ...system, locale: "sk" },
				);
			}
		}
	}, 30_000);

	afterAll(async () => {
		await setup.cleanup();
		await client.close();
	});

	beforeEach(() => {
		hiddenReadCalls = 0;
		visibleBeforeReadCalls = 0;
		gatedInputs.length = 0;
		parentPolicy = true;
		junctionRead = true;
		statements.length = 0;
	});

	describe("caller relation predicates", () => {
		it("treat a denied target as an empty relation set", async () => {
			const alpha = { secret: { eq: "alpha" } };
			expect(await findNames({ hidden: { some: alpha } })).toEqual([]);
			expect(await countWhere({ hidden: { some: alpha } })).toBe(0);
			expect(await findNames({ hidden: { none: alpha } })).toEqual(["A", "B"]);
			expect(await countWhere({ hidden: { none: alpha } })).toBe(2);
			expect(await findNames({ hidden: { every: alpha } })).toEqual(["A", "B"]);
			expect(
				await findNames({ hidden: { every: { secret: { eq: "absent" } } } }),
			).toEqual(["A", "B"]);
			expect(await findNames({ hidden: {} })).toEqual([]);
			expect(hiddenReadCalls).toBeGreaterThan(0);
		});

		it("keep the direct and hydrated reads of a denied target forbidden", async () => {
			await expect(c.rra_hidden.find({}, user)).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			await expect(
				c.rra_parents.find({ with: { hidden: true } }, user),
			).rejects.toMatchObject({ code: "FORBIDDEN" });
		});

		it("restrict the relation set to the target's access predicate before quantifying", async () => {
			const x = { secret: { eq: "x" } };
			expect(await findNames({ scoped: { some: x } })).toEqual(["B"]);
			expect(await findNames({ scoped: { every: x } })).toEqual(["B"]);
			expect(await findNames({ scoped: { none: x } })).toEqual(["A"]);
			expect(await findNames({ scoped: x })).toEqual(["B"]);
		});

		it("apply the gate before parent pagination and totals", async () => {
			const result = await c.rra_parents.find(
				{ where: { scoped: { some: { secret: { eq: "x" } } } }, limit: 1 },
				user,
			);
			expect(result.docs.map((doc: any) => doc.name)).toEqual(["B"]);
			expect(result.totalDocs).toBe(1);
			expect(result.totalPages).toBe(1);

			const denied = await c.rra_parents.find(
				{ where: { hidden: { some: { secret: { eq: "alpha" } } } }, limit: 1 },
				user,
			);
			expect(denied.docs).toEqual([]);
			expect(denied.totalDocs).toBe(0);
		});

		it("gate to-one relations", async () => {
			const o1 = { name: { eq: "o1" } };
			expect(await findNames({ owner: { is: o1 } })).toEqual([]);
			expect(await findNames({ owner: o1 })).toEqual([]);
			expect(await findNames({ owner: { isNot: o1 } })).toEqual(["A", "B"]);
			// A plain foreign-key filter is a column predicate, not a relation read.
			expect(await findNames({ owner: { isNotNull: true } })).toEqual(["A"]);
		});

		it("gate many-to-many targets and their junction", async () => {
			expect(
				await findNames({ tags: { some: { label: { eq: "red" } } } }),
			).toEqual([]);
			expect(
				await findNames({ labels: { some: { text: { eq: "blue" } } } }),
			).toEqual(["A"]);
			junctionRead = false;
			expect(
				await findNames({ labels: { some: { text: { eq: "blue" } } } }),
			).toEqual([]);
			junctionRead = { parent: { eq: ids.B } };
			expect(
				await findNames({ labels: { some: { text: { eq: "blue" } } } }),
			).toEqual([]);
		});

		it("gate every hop of a nested caller predicate", async () => {
			expect(
				await findNames({
					visible: {
						some: {
							parent: {
								is: { hidden: { some: { secret: { eq: "alpha" } } } },
							},
						},
					},
				}),
			).toEqual([]);
			expect(
				await findNames({
					visible: { some: { parent: { is: { name: { eq: "A" } } } } },
				}),
			).toEqual(["A"]);
		});

		it("restrict a self-referential relation through its aliased access predicate", async () => {
			const nodeNames = async (where: unknown, context = user) =>
				(await c.rra_nodes.find({ where }, context)).docs
					.map((doc: any) => doc.name)
					.sort();
			expect(
				await nodeNames({ down: { some: { name: { eq: "a-hidden" } } } }),
			).toEqual([]);
			expect(
				await nodeNames({ down: { some: { name: { eq: "b" } } } }),
			).toEqual(["R"]);
			expect(
				await nodeNames({ down: { every: { visible: { eq: true } } } }),
			).toEqual(["b", "c", "R"].sort());
			expect(
				await nodeNames(
					{ down: { some: { name: { eq: "a-hidden" } } } },
					system,
				),
			).toEqual(["R"]);
		});

		it("follow the parent's read decision for upload relations", async () => {
			await expect(c.rra_files.find({}, user)).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			expect(
				await findNames({ cover: { is: { mimeType: { eq: "image/png" } } } }),
			).toEqual(["A"]);
		});

		it("decide each relation read with its own concrete input", async () => {
			const publicRead = { gated: { some: { status: { eq: "public" } } } };
			const privateRead = { gated: { some: { status: { eq: "private" } } } };
			expect(await findNames(publicRead)).toEqual(["A"]);
			expect(await findNames(privateRead)).toEqual([]);
			// Two reads of one collection in one query never share a decision.
			expect(await findNames({ OR: [publicRead, privateRead] })).toEqual(["A"]);
			expect(await findNames({ OR: [privateRead, publicRead] })).toEqual(["A"]);
			expect(gatedInputs).toContainEqual({
				where: { status: { eq: "public" } },
			});
			expect(gatedInputs).toContainEqual({
				where: { status: { eq: "private" } },
			});

			// `every` reads the rows that fail it, which this rule refuses.
			gatedInputs.length = 0;
			expect(
				await findNames({ gated: { every: { status: { eq: "public" } } } }),
			).toEqual(["A", "B"]);
			expect(gatedInputs).toEqual([
				{ where: { NOT: { status: { eq: "public" } } } },
			]);
		});

		it("compare localized target fields in the request locale", async () => {
			const localizedNames = async (label: string, locale: string) =>
				names(
					await c.rra_parents.find(
						{ where: { localized: { some: { label: { eq: label } } } } },
						{ ...user, locale },
					),
				);
			expect(await localizedNames("a1-en", "en")).toEqual(["A"]);
			expect(await localizedNames("a1-sk", "sk")).toEqual(["A"]);
			expect(await localizedNames("a1-en", "sk")).toEqual([]);
			// a2 has no sk translation and falls back to en.
			expect(await localizedNames("a2-en", "sk")).toEqual(["A"]);
		});

		it("evaluate a localized target policy against the target's own translation", async () => {
			const labels = async (where: unknown, context = user) =>
				(await c.rra_lparents.find({ where }, context)).docs
					.map((doc: any) => doc.label)
					.sort();
			expect(await labels({ kids: { some: {} } })).toEqual(["other"]);
			expect(await labels({ kids: { none: {} } })).toEqual(["public"]);
			expect(
				await labels({ kids: { some: { label: { eq: "secret" } } } }, system),
			).toEqual(["public"]);
		});

		it("refuses a localized target policy when translation metadata is unavailable", async () => {
			const target = setup.app.getCollections().rra_lkids;
			const translations = target.i18nTable;
			target.i18nTable = null;
			try {
				await expect(
					c.rra_lparents.find({ where: { kids: { some: {} } } }, user),
				).rejects.toThrow("Cannot compile localized relation predicate");
				expect(targetStatements("rra_lkids")).toHaveLength(0);
			} finally {
				target.i18nTable = translations;
			}
		});

		it("gate relation predicates inside a hydrated relation's where", async () => {
			const result = await c.rra_parents.find(
				{
					orderBy: { name: "asc" },
					with: {
						visible: {
							where: {
								parent: {
									is: { hidden: { some: { secret: { eq: "alpha" } } } },
								},
							},
						},
					},
				},
				user,
			);
			expect(result.docs.map((doc: any) => doc.visible)).toEqual([[], []]);
		});

		it("keep system mode ungated", async () => {
			const alpha = { secret: { eq: "alpha" } };
			expect(await findNames({ hidden: { some: alpha } }, system)).toEqual([
				"A",
			]);
			expect(await findNames({ hidden: { none: alpha } }, system)).toEqual([
				"B",
			]);
			expect(await findNames({ hidden: { every: alpha } }, system)).toEqual([
				"A",
			]);
			expect(await countWhere({ hidden: { some: alpha } }, system)).toBe(1);
			expect(
				await findNames({ scoped: { some: { secret: { eq: "x" } } } }, system),
			).toEqual(["A", "B"]);
			expect(hiddenReadCalls).toBe(0);
		});

		it("keep a trusted access predicate able to read across resources", async () => {
			parentPolicy = { hidden: { some: { secret: { eq: "alpha" } } } };
			expect(await findNames(undefined)).toEqual(["A"]);
			expect(await c.rra_parents.count({}, user)).toBe(1);
			expect(hiddenReadCalls).toBe(0);

			// The caller's half of the same query is still gated.
			expect(
				await findNames({ hidden: { some: { secret: { eq: "alpha" } } } }),
			).toEqual([]);
		});
	});

	describe("hasMany limit and offset", () => {
		const hydrate = async (withConfig: unknown, context = user) =>
			(
				await c.rra_parents.find(
					{ orderBy: { name: "asc" }, with: withConfig },
					context,
				)
			).docs;

		it("bound each parent separately", async () => {
			const docs = await hydrate({
				visible: { limit: 1, orderBy: { name: "asc" } },
			});
			expect(
				docs.map((doc: any) => doc.visible.map((v: any) => v.name)),
			).toEqual([["A1"], ["B1"]]);
		});

		it("page each parent separately", async () => {
			const docs = await hydrate({
				visible: { limit: 1, offset: 1, orderBy: { name: "desc" } },
			});
			expect(
				docs.map((doc: any) => doc.visible.map((v: any) => v.name)),
			).toEqual([["A2"], ["B2"]]);
			const offsetOnly = await hydrate({
				visible: { offset: 2, orderBy: { name: "asc" } },
			});
			expect(
				offsetOnly.map((doc: any) => doc.visible.map((v: any) => v.name)),
			).toEqual([["A3"], ["B3"]]);
		});

		it("does not let hidden or deleted children consume the bound", async () => {
			const docs = await hydrate({
				scoped: { limit: 1, orderBy: { secret: "asc" } },
			});
			expect(
				docs.map((doc: any) => doc.scoped.map((s: any) => s.secret)),
			).toEqual([["y"], ["x"]]);
			const unrestricted = await hydrate(
				{ scoped: { limit: 1, orderBy: { secret: "asc" } } },
				system,
			);
			expect(
				unrestricted.map((doc: any) => doc.scoped.map((s: any) => s.secret)),
			).toEqual([["x"], ["x"]]);
		});

		it("reads every parent's window in one target query without a total", async () => {
			await hydrate({ visible: { limit: 2, orderBy: { name: "asc" } } });
			expect(visibleBeforeReadCalls).toBe(1);
			const reads = targetStatements("rra_visible");
			expect(reads).toHaveLength(1);
			expect(reads.some((statement) => /count\s*\(/i.test(statement))).toBe(
				false,
			);
		});

		it("keeps selected keys, nested relations and the target's where", async () => {
			const docs = await hydrate({
				visible: {
					limit: 1,
					orderBy: { name: "desc" },
					where: { name: { ne: "A3" } },
					columns: { name: true },
					with: { parent: { columns: { name: true } } },
				},
			});
			expect(
				docs.map((doc: any) =>
					doc.visible.map((v: any) => [v.name, v.parent.name]),
				),
			).toEqual([[["A2", "A"]], [["B3", "B"]]]);
			expect(Object.keys(docs[0].visible[0]).sort()).toEqual(
				["id", "name", "parent"].sort(),
			);
		});

		it("keeps localized values and fallback", async () => {
			const docs = await hydrate(
				{ localized: { limit: 2, orderBy: { rank: "asc" } } },
				{ ...user, locale: "sk" },
			);
			expect(
				docs.map((doc: any) => doc.localized.map((l: any) => l.label)),
			).toEqual([["a1-sk", "a2-en"], ["b1-sk"]]);
		});

		it("attaches no row whose foreign key field access hides, like an unbounded read", async () => {
			const bounded = await hydrate({ keyHidden: { limit: 1 } });
			const unbounded = await hydrate({ keyHidden: true });
			expect(bounded.map((doc: any) => doc.keyHidden)).toEqual([[], []]);
			expect(unbounded.map((doc: any) => doc.keyHidden)).toEqual([[], []]);
			const unrestricted = await hydrate({ keyHidden: { limit: 1 } }, system);
			expect(unrestricted.map((doc: any) => doc.keyHidden.length)).toEqual([
				1, 1,
			]);
		});

		it("accepts query-string bounds and rejects malformed ones", async () => {
			const docs = await hydrate({
				visible: { limit: "1", offset: "1", orderBy: { name: "asc" } },
			});
			expect(
				docs.map((doc: any) => doc.visible.map((v: any) => v.name)),
			).toEqual([["A2"], ["B2"]]);
			for (const limit of ["x", -1, 1.5]) {
				await expect(hydrate({ visible: { limit } })).rejects.toMatchObject({
					code: "BAD_REQUEST",
				});
			}
		});

		it("bounds a self-referential relation without counting hidden rows", async () => {
			const docs = (
				await c.rra_nodes.find(
					{
						where: { name: { eq: "R" } },
						with: { down: { limit: 1, orderBy: { name: "asc" } } },
					},
					user,
				)
			).docs;
			expect(docs.map((doc: any) => doc.down.map((d: any) => d.name))).toEqual([
				["b"],
			]);
		});

		it("bound many-to-many targets per parent through the authorized links", async () => {
			const topicNames = (docs: any[]) =>
				docs.map((doc) => doc.topics.map((t: any) => t.name));
			expect(
				topicNames(
					await hydrate({ topics: { limit: 1, orderBy: { name: "asc" } } }),
				),
			).toEqual([["t-a"], ["t-a"]]);
			expect(
				topicNames(
					await hydrate({ topics: { limit: 2, orderBy: { name: "desc" } } }),
				),
			).toEqual([
				["t-c", "t-a"],
				["t-d", "t-a"],
			]);
			expect(
				topicNames(
					await hydrate(
						{ topics: { limit: 2, orderBy: { name: "desc" } } },
						system,
					),
				),
			).toEqual([
				["t-c", "t-b"],
				["t-d", "t-a"],
			]);
			expect(
				topicNames(
					await hydrate({
						topics: { limit: 1, offset: 1, orderBy: { name: "asc" } },
					}),
				),
			).toEqual([["t-c"], ["t-d"]]);

			junctionRead = { parent: { eq: ids.B } };
			expect(
				topicNames(
					await hydrate({ topics: { limit: 1, orderBy: { name: "asc" } } }),
				),
			).toEqual([[], ["t-a"]]);
		});

		it("reads a many-to-many window in one target query without a total", async () => {
			await hydrate({ topics: { limit: 1, orderBy: { name: "asc" } } });
			const reads = targetStatements("rra_topics");
			expect(reads).toHaveLength(1);
			expect(reads[0]).toMatch(/row_number\(\) over \(partition by/i);
			expect(reads[0]).not.toMatch(/count\s*\(/i);
			const unbounded = await hydrate({ topics: true });
			expect(
				unbounded.map((doc: any) => doc.topics.map((t: any) => t.name).sort()),
			).toEqual([
				["t-a", "t-c"],
				["t-a", "t-d"],
			]);
		});

		it("keeps many-to-many columns, nested relations, locale and caller filters", async () => {
			const docs = await hydrate(
				{
					topics: {
						limit: 1,
						orderBy: { name: "asc" },
						where: { name: { ne: "t-c" } },
						columns: { name: true, label: true },
						with: { links: { columns: { parent: true } } },
					},
				},
				{ ...user, locale: "sk" },
			);
			expect(
				docs.map((doc: any) =>
					doc.topics.map((topic: any) => [
						topic.name,
						topic.label,
						topic.links.map((link: any) => link.parent).sort(),
					]),
				),
			).toEqual([
				[["t-a", "t-a-sk", [ids.A, ids.B].sort()]],
				[["t-a", "t-a-sk", [ids.A, ids.B].sort()]],
			]);
			expect(Object.keys(docs[0].topics[0]).sort()).toEqual([
				"id",
				"label",
				"links",
				"name",
			]);
			const fallback = await hydrate(
				{ topics: { offset: 1, orderBy: { name: "asc" } } },
				{ ...user, locale: "sk" },
			);
			expect(
				fallback.map((doc: any) => doc.topics.map((topic: any) => topic.label)),
			).toEqual([["t-c-en"], ["t-d-en"]]);
		});

		it("leaves an unbounded hydration unchanged", async () => {
			const docs = await hydrate({ visible: { orderBy: { name: "asc" } } });
			expect(
				docs.map((doc: any) => doc.visible.map((v: any) => v.name)),
			).toEqual([
				["A1", "A2", "A3"],
				["B1", "B2", "B3"],
			]);
		});

		it("keeps a bounded read of a denied target forbidden", async () => {
			await expect(hydrate({ hidden: { limit: 1 } })).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			await expect(hydrate({ tags: { limit: 1 } })).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
		});

		it("inherits upload access through a bounded many-to-many relation", async () => {
			await expect(c.rra_parent_files.find({}, user)).rejects.toMatchObject({
				code: "FORBIDDEN",
			});
			const docs = await hydrate({ gallery: { limit: 1 } });
			expect(docs.map((doc: any) => doc.gallery.length)).toEqual([1, 1]);
			expect(docs[0].gallery[0].filename).toBe("cover.png");
			expect(docs[0].gallery[0].url).toBeString();
		});
	});
});
