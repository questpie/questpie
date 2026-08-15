import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("emits exact one-hop Relation descriptors without a recursive target graph", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-relations-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const accountSource = (relations: string) =>
			`import { constraint, defineCollection, field, relation, relationRef, shape } from "questpie";

export const relationAccounts = defineCollection({
	name: "relationAccounts",
	fields: {
		id: field.uuid({ default: "randomUuid" }),
		profile: shape.inline({ fields: {
			displayName: field.text({ maxLength: 160 }),
		} }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
${relations}
});
`;
		await writeFile(
			join(temporary, "src/relation-accounts.ts"),
			accountSource(`\trelations: {
		entries: relation.toMany({
			inverseOf: relationRef("relationEntries", "account"),
		}),
	},`),
		);
		await writeFile(
			join(temporary, "src/relation-entries.ts"),
			`import { constraint, defineCollection, field, relation, relationRef } from "questpie";

export const relationEntries = defineCollection({
	name: "relationEntries",
	fields: {
		id: field.uuid({ default: "randomUuid" }),
		accountId: field.uuid(),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
	relations: {
		account: relation.toOne({
			target: relationRef("relationAccounts"),
			fields: ["accountId"],
			references: ["id"],
		}),
	},
});
`,
		);
		await writeFile(
			join(temporary, "src/relation-consumer.ts"),
			`import { relation, relationRef, type RelationReference } from "questpie";
import type { AppData } from "#questpie/app";

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends
	(<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;
type Accounts = AppData["collections"]["relationAccounts"];
type Entries = AppData["collections"]["relationEntries"];
const inverseReference = relationRef("relationEntries", "account");
type ExactReference = Expect<Equal<
	typeof inverseReference,
	RelationReference<"relationEntries", "account">
>>;
// @ts-expect-error inverse Relations cannot own PostgreSQL schema options
relation.toMany({ inverseOf: inverseReference, postgres: { name: "shadow" } });

type Owning = Expect<Equal<
	Entries["relations"]["account"],
	Readonly<{
		kind: "toOne";
		identity: "collection:relationEntries/relation:account";
		target: Readonly<{
			name: "relationAccounts";
			identity: "collection:relationAccounts";
			fields: Accounts["fields"];
		}>;
	}>
>>;
type Inverse = Expect<Equal<
	Accounts["relations"]["entries"],
	Readonly<{
		kind: "toMany";
		identity: "collection:relationAccounts/relation:entries";
		target: Readonly<{
			name: "relationEntries";
			identity: "collection:relationEntries";
			fields: Entries["fields"];
		}>;
		inverseOf: "collection:relationEntries/relation:account";
	}>
>>;
type NestedTargetField = Expect<Equal<
	Entries["relations"]["account"]["target"]["fields"]["profile"]["displayName"]["identity"],
	"collection:relationAccounts/field:profile/field:displayName"
>>;
type OneHop = Expect<Equal<
	keyof Accounts["relations"]["entries"]["target"],
	"fields" | "identity" | "name"
>>;
// @ts-expect-error Relation targets never carry another Relation graph
type NoRecursiveRelations = Accounts["relations"]["entries"]["target"]["relations"];
// @ts-expect-error Relation targets do not carry row shapes
type NoTargetRow = Accounts["relations"]["entries"]["target"]["row"];

void (0 as unknown as Owning);
void (0 as unknown as ExactReference);
void (0 as unknown as Inverse);
void (0 as unknown as NestedTargetField);
void (0 as unknown as OneHop);
void (0 as unknown as NoRecursiveRelations);
void (0 as unknown as NoTargetRow);
`,
		);

		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		const schema = JSON.parse(
			compilation.generatedFiles["schema-projection.json"]!,
		);
		const manifest = JSON.parse(compilation.generatedFiles["manifest.json"]!);
		const schemaAccounts = schema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:relationAccounts",
		);
		const schemaEntries = schema.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:relationEntries",
		);
		const dataAccounts = manifest.data.collections.find(
			(collection: { identity: string }) =>
				collection.identity === "collection:relationAccounts",
		);
		expect(schemaAccounts.relations).toEqual([]);
		expect(schemaEntries.relations).toHaveLength(1);
		expect(dataAccounts.relations).toEqual([
			expect.objectContaining({
				kind: "toMany",
				inverseOf: "collection:relationEntries/relation:account",
				target: "collection:relationEntries",
			}),
		]);

		await rm(join(temporary, "src/relation-consumer.ts"));
		await writeFile(
			join(temporary, "src/relation-accounts.ts"),
			accountSource(""),
		);
		const withoutInverse = await compileApplication({
			applicationRoot: temporary,
		});
		expect(withoutInverse.generatedFiles["schema-projection.json"]).toBe(
			compilation.generatedFiles["schema-projection.json"],
		);
	} finally {
		await rm(temporary, { recursive: true });
	}
});

test("rejects invalid inverse Relation definitions and references", async () => {
	for (const hostile of [
		{
			inverse: 'relationRef("missingEntries", "account")',
			diagnostic:
				/QP-COMPOSE-004 unresolvedReference: .* references missing collection:missingEntries\/relation:account/,
		},
		{
			inverse: 'relationRef("channels", "space")',
			diagnostic:
				/QP-DATA-003 invalidRelationReference: collection:channels\/relation:space does not target collection:invalidInverse/,
		},
		{
			inverse: 'relationRef("wrongKindPeer", "entries")',
			extra: `export const wrongKindPeer = defineCollection({
	name: "wrongKindPeer",
	fields: { id: field.uuid() },
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
	relations: {
		entries: relation.toMany({
			inverseOf: relationRef("invalidInverse", "entries"),
		}),
	},
});`,
			diagnostic:
				/QP-DATA-003 invalidRelationReference: collection:wrongKindPeer\/relation:entries is not an owning toOne Relation/,
		},
		{
			inverse:
				'relation.toMany({ inverseOf: relationRef("channels", "space"), postgres: { name: "shadow" } } as any)',
			wrapsFactory: true,
			diagnostic:
				/QP-SCHEMA-001 invalidDefinition: relation.toMany accepts only inverseOf/,
		},
	] as const) {
		const temporary = await mkdtemp(join(tmpdir(), "questpie-bad-inverse-"));
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/invalid-inverse.ts"),
				`import { constraint, defineCollection, field, relation, relationRef } from "questpie";

export const invalidInverse = defineCollection({
	name: "invalidInverse",
	fields: { id: field.uuid() },
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
	relations: { entries: ${"wrapsFactory" in hostile ? hostile.inverse : `relation.toMany({ inverseOf: ${hostile.inverse} })`} },
});
${"extra" in hostile ? hostile.extra : ""}
`,
			);
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toThrow(hostile.diagnostic);
		} finally {
			await rm(temporary, { recursive: true });
		}
	}
});
