import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("emits the exact Collection descriptor from the Data Projection", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-data-contract-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await writeFile(
			join(temporary, "src/contract-customers.ts"),
			`import { constraint, defineCollection, field, shape, value } from "questpie";

export const contractCustomers = defineCollection({
	name: "contractCustomers",
	fields: {
		id: field.uuid({ default: "randomUuid" }),
		address: shape.inline({ fields: {
			city: field.text({ maxLength: 160 }),
			note: field.text({ nullable: true }),
		} }),
		details: shape.inline({ fields: {
			createdAt: field.timestamp({ default: "now", withTimezone: true }),
			note: field.text({ nullable: true }),
		} }),
		preferences: field.object({
			nullable: true,
			properties: {
				aliases: value.array({
					items: value.text({ nullable: true }),
					maximumItems: 10,
					nullable: false,
				}),
				locale: value.text({ nullable: false, maxLength: 16 }),
				marketingEmail: value.boolean({ nullable: true }),
			},
		}),
		sequence: field.integer(),
	},
	constraints: {
		primary: constraint.primaryKey({ fields: [["address", "city"], "sequence"] }),
		idUnique: constraint.unique({ fields: ["id"] }),
	},
});
`,
		);
		await writeFile(
			join(temporary, "src/contract-consumer.ts"),
			`import type { DataFieldDescriptor } from "questpie";
import type { AppContract, AppData } from "#questpie/app";

type Equal<Left, Right> =
	(<Value>() => Value extends Left ? 1 : 2) extends
	(<Value>() => Value extends Right ? 1 : 2) ? true : false;
type Expect<Value extends true> = Value;
type Customer = AppData["collections"]["contractCustomers"];

type DataAlias = Expect<Equal<AppData, AppContract["data"]>>;
type Name = Expect<Equal<Customer["name"], "contractCustomers">>;
type Identity = Expect<Equal<Customer["identity"], "collection:contractCustomers">>;
type CityIdentity = Expect<Equal<
	Customer["fields"]["address"]["city"]["identity"],
	"collection:contractCustomers/field:address/field:city"
>>;
type CityCodec = Expect<Equal<
	Customer["fields"]["address"]["city"]["codec"],
	Readonly<{ readonly collation: "questpie.binary"; readonly kind: "text"; readonly maxLength: 160; readonly minLength: null }>
>>;
type PreferencesValue = Customer["fields"]["preferences"] extends DataFieldDescriptor<
	infer _Identity,
	infer _Codec,
	infer Value,
	infer _Nullable,
	infer _HasDefault
> ? Value : never;
type EmbeddedNullability = Expect<Equal<
	PreferencesValue,
	Readonly<{
		aliases: readonly (string | null)[];
		locale: string;
		marketingEmail: boolean | null;
	}>
>>;
type PrimaryTuple = Expect<Equal<
	Customer["uniqueConstraints"]["primary"]["fields"],
	readonly [readonly ["address", "city"], "sequence"]
>>;
type UniqueTuple = Expect<Equal<
	Customer["uniqueConstraints"]["idUnique"]["fields"],
	readonly ["id"]
>>;
type Row = Expect<Equal<
	Customer["row"],
	Readonly<{
		address: Readonly<{ city: string; note: string | null }>;
		details: Readonly<{ createdAt: string; note: string | null }>;
		id: string;
		preferences: Readonly<{
			aliases: readonly (string | null)[];
			locale: string;
			marketingEmail: boolean | null;
		}> | null;
		sequence: number;
	}>
>>;
type Insert = Expect<Equal<
	Customer["insert"],
	Readonly<{
		address: Readonly<{ city: string; note?: string | null }>;
		details?: Readonly<{ createdAt?: string; note?: string | null }>;
		id?: string;
		preferences?: Readonly<{
			aliases: readonly (string | null)[];
			locale: string;
			marketingEmail: boolean | null;
		}> | null;
		sequence: number;
	}>
>>;
type Update = Expect<Equal<
	Customer["update"],
	Readonly<{
		address?: Readonly<{ city?: string; note?: string | null }>;
		details?: Readonly<{ createdAt?: string; note?: string | null }>;
		id?: string;
		preferences?: Readonly<{
			aliases: readonly (string | null)[];
			locale: string;
			marketingEmail: boolean | null;
		}> | null;
		sequence?: number;
	}>
>>;

const insert: Customer["insert"] = {
	address: { city: "Bratislava" },
	sequence: 1,
};
const update: Customer["update"] = { address: { note: null } };
// @ts-expect-error a required inline leaf keeps its parent required on insert
const missingAddress: Customer["insert"] = { sequence: 1 };
// @ts-expect-error update remains exact at nested leaves
const unknownUpdate: Customer["update"] = { address: { unknown: true } };

void (0 as unknown as DataAlias);
void (0 as unknown as Name);
void (0 as unknown as Identity);
void (0 as unknown as CityIdentity);
void (0 as unknown as CityCodec);
void (0 as unknown as EmbeddedNullability);
void (0 as unknown as PrimaryTuple);
void (0 as unknown as UniqueTuple);
void (0 as unknown as Row);
void (0 as unknown as Insert);
void (0 as unknown as Update);
void insert;
void update;
void missingAddress;
void unknownUpdate;
`,
		);
		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		expect(compilation.generatedFiles["app.ts"]).toContain(
			'export type AppData = AppContract["data"]',
		);
		expect(compilation.generatedFiles["app.ts"]).toContain(
			'readonly "idUnique": Readonly<{ readonly kind: "unique";',
		);
	} finally {
		await rm(temporary, { recursive: true });
	}
});
