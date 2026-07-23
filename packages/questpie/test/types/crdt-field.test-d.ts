import { z } from "zod";

import type {
	CrdtAwarenessOf,
	IsEligibleCrdtTextField,
} from "#questpie/server/fields/field-class-types.js";
import { textarea } from "#questpie/server/modules/core/fields/textarea.js";

import type { Equal, Expect } from "./type-test-utils.js";

const awarenessSchema = z.object({ cursor: z.number().optional() });

const cursorAwareness = textarea().default("").required().crdt({
	format: "text",
	awareness: awarenessSchema,
});

const markerBeforeRefinements = textarea()
	.crdt({ format: "text" })
	.default("")
	.required()
	.label("Content")
	.access({ read: true, update: true });

const invalidNullable = textarea().crdt({ format: "text" });
const invalidLocalized = textarea()
	.default("")
	.required()
	.localized()
	.crdt({ format: "text" });
const invalidArray = textarea()
	.default("")
	.required()
	.array()
	.crdt({ format: "text" });
const invalidHooks = textarea()
	.default("")
	.required()
	.hooks({ beforeChange: (value) => value })
	.crdt({ format: "text" });

type _eligibleAfter = Expect<
	Equal<IsEligibleCrdtTextField<typeof cursorAwareness>, true>
>;
type _eligibleBefore = Expect<
	Equal<IsEligibleCrdtTextField<typeof markerBeforeRefinements>, true>
>;
type _nullableRejected = Expect<
	Equal<IsEligibleCrdtTextField<typeof invalidNullable>, false>
>;
type _localizedRejected = Expect<
	Equal<IsEligibleCrdtTextField<typeof invalidLocalized>, false>
>;
type _arrayRejected = Expect<
	Equal<IsEligibleCrdtTextField<typeof invalidArray>, false>
>;
type _hooksRejected = Expect<
	Equal<IsEligibleCrdtTextField<typeof invalidHooks>, false>
>;
type _awarenessOutput = CrdtAwarenessOf<typeof cursorAwareness>;
type _awareness = Expect<
	Equal<_awarenessOutput, z.output<typeof awarenessSchema>>
>;
