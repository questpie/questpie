import { batchRead as builderBatchRead } from "#questpie/exports/builders.js";
import { batchRead, collection } from "#questpie/exports/index.js";
import type { FieldAccessRule } from "#questpie/server/collection/builder/types.js";
import type { AnyDrizzleClient } from "#questpie/server/config/types.js";
import type { BatchReadContext } from "#questpie/server/fields/batch-read.js";
import type { FieldAccess } from "#questpie/server/fields/types.js";

import type { Equal, Expect } from "./type-test-utils.js";

interface Doc {
	id: string;
	owner: string;
}

const policy = batchRead<Doc>(async (ctx) => {
	type _docs = Expect<Equal<typeof ctx.docs, readonly Doc[]>>;
	type _operation = Expect<Equal<typeof ctx.operation, "read">>;
	type _db = Expect<Equal<typeof ctx.db, AnyDrizzleClient>>;
	// @ts-expect-error Batch docs are a readonly page.
	ctx.docs.push({ id: "extra", owner: "extra" });
	// @ts-expect-error Batch callbacks have docs instead of one doc.
	ctx.doc;
	return ctx.docs.map((doc) => doc.owner === "owner");
});

const fieldRule: FieldAccess["read"] = policy;
const collectionFieldRule: FieldAccessRule<Doc> = policy;
const readonlyDecisions = builderBatchRead(() => [true, false] as const);
const builderRule: FieldAccess["read"] = readonlyDecisions;

type _legacyContextHasNoDb = Expect<
	Equal<
		"db" extends keyof Parameters<
			Exclude<FieldAccess["read"], boolean | undefined>
		>[0]
			? true
			: false,
		false
	>
>;
type _batchDbRequired = Expect<
	Equal<undefined extends BatchReadContext["db"] ? true : false, false>
>;

// @ts-expect-error A field decision must be boolean, not an AccessWhere.
batchRead(({ docs }) => docs.map(() => ({ owner: "owner" })));
// @ts-expect-error A batch callback must return an array of decisions.
batchRead(() => true);

collection("batch_typed")
	.fields(({ f }) => ({
		secret: f.text().access({ read: policy }),
		legacy: f.text().access({ read: ({ doc }) => doc?.owner === "owner" }),
	}))
	.access({ fields: { secret: { read: policy } } });

void fieldRule;
void collectionFieldRule;
void builderRule;
