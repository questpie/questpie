import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../..");

test("Collection input helpers infer exact provenance-derived codecs", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-adr0030-types-"));
	try {
		const fixture = join(temporary, "authoring.ts");
		await writeFile(
			fixture,
			`import { codec, constraint, defineCollection, field, value } from "questpie";
import type { CodecValue, TaggedJsonValue } from "questpie";

type Equal<Left, Right> = [Left] extends [Right]
	? [Right] extends [Left]
		? true
		: false
	: false;
type Expect<Value extends true> = Value;

const tickets = defineCollection({
	name: "tickets",
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid", server: true, immutable: true }),
		reference: field.text({ nullable: false, immutable: true }),
		summary: field.text({ nullable: false, maxLength: 240 }),
		priority: field.text({ nullable: false, default: "normal" }),
		assigneeId: field.uuid({ nullable: true }),
		status: field.text({ nullable: false, default: "open", server: true }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

const create = tickets.createInput();
const update = tickets.updateInput();
type Create = CodecValue<typeof create>;
type Update = CodecValue<typeof update>;
type ExpectedCreate = Readonly<{
	reference: string;
	summary: string;
	priority?: string;
	assigneeId?: string | null;
}>;
declare const createValue: Create;
const expectedCreate: ExpectedCreate = createValue;
const createRoundTrip: Create = {} as ExpectedCreate;
type ExpectedUpdate = Readonly<{
	summary?: string;
	priority?: string;
	assigneeId?: string | null;
}>;
declare const updateValue: Update;
const expectedUpdate: ExpectedUpdate = updateValue;
const updateRoundTrip: Update = {} as ExpectedUpdate;

const picked = create.pick({ reference: true, assigneeId: true });
type ExpectedPicked = Readonly<{
	reference: string;
	assigneeId?: string | null;
}>;
const expectedPicked: ExpectedPicked = {} as CodecValue<typeof picked>;
const pickedRoundTrip: CodecValue<typeof picked> = {} as ExpectedPicked;
const omitted = update.omit({ priority: true });
type ExpectedOmitted = Readonly<{
	summary?: string;
	assigneeId?: string | null;
}>;
const expectedOmitted: ExpectedOmitted = {} as CodecValue<typeof omitted>;
const omittedRoundTrip: CodecValue<typeof omitted> = {} as ExpectedOmitted;

const allKinds = defineCollection({
	name: "allKinds",
	fields: {
		id: field.uuid({ nullable: false, server: true, immutable: true }),
		title: field.text({ nullable: false, minLength: 2, maxLength: 40 }),
		active: field.boolean({ nullable: false }),
		rank: field.integer({ nullable: false, minimum: -4, maximum: 12 }),
		sequence: field.bigint({ nullable: false, minimum: "-9", maximum: "99" }),
		amount: field.numeric({ nullable: false, precision: 12, scale: 3 }),
		occurredAt: field.timestamp({ nullable: false, withTimezone: true }),
		businessDate: field.date({ nullable: false }),
		profile: field.object({
			nullable: false,
			properties: {
				label: value.text({ nullable: false, maxLength: 24 }),
				seenAt: value.timestamp({ nullable: true, withTimezone: true }),
				moments: value.array({
					nullable: false,
					items: value.timestamp({ nullable: false, withTimezone: true }),
					maximumItems: 3,
				}),
			},
		}),
		tags: field.array({
			nullable: false,
			items: value.uuid({ nullable: false }),
			maximumItems: 5,
		}),
		metadata: field.json({ nullable: false }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["title"] }) },
});
type AllKindsCreate = CodecValue<ReturnType<typeof allKinds.createInput>>;
type ExpectedAllKindsCreate = Readonly<{
	title: string;
	active: boolean;
	rank: number;
	sequence: string;
	amount: string;
	occurredAt: Date;
	businessDate: string;
	profile: Readonly<{
		label: string;
		seenAt: Date | null;
		moments: readonly Date[];
	}>;
	tags: readonly string[];
	metadata: TaggedJsonValue;
}>;
declare const allKindsCreate: AllKindsCreate;
const expectedAllKindsCreate: ExpectedAllKindsCreate = allKindsCreate;
const allKindsCreateRoundTrip: AllKindsCreate = {} as ExpectedAllKindsCreate;

void [expectedCreate, createRoundTrip, expectedUpdate, updateRoundTrip, expectedPicked, pickedRoundTrip, expectedOmitted, omittedRoundTrip, expectedAllKindsCreate, allKindsCreateRoundTrip];

codec.object({ ticketId: codec.uuid(), ...picked.properties });
// @ts-expect-error Input helpers are codecs, not Resources or Operations.
create.__questpie;
// @ts-expect-error server Fields never belong to caller create input.
create.pick({ status: true });
// @ts-expect-error immutable Fields never belong to caller update input.
update.pick({ reference: true });
// @ts-expect-error selectors reject unknown Fields.
update.omit({ missing: true });
`,
		);
		await writeFile(
			join(temporary, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: {
					baseUrl: repositoryRoot,
					ignoreDeprecations: "6.0",
					lib: ["DOM", "ESNext"],
					module: "ESNext",
					moduleResolution: "Bundler",
					noEmit: true,
					paths: { questpie: ["packages/questpie/src/index.ts"] },
					skipLibCheck: true,
					strict: true,
					target: "ESNext",
					types: [],
				},
				files: [fixture],
			}),
		);

		const result = Bun.spawnSync(
			[
				"bun",
				"node_modules/typescript/bin/tsc",
				"-p",
				join(temporary, "tsconfig.json"),
				"--pretty",
				"false",
			],
			{ cwd: repositoryRoot, stderr: "pipe", stdout: "pipe" },
		);
		expect(`${result.stdout.toString()}${result.stderr.toString()}`).toBe("");
		expect(result.exitCode).toBe(0);
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});
