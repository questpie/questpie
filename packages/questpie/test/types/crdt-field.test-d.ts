import type {
	CrdtFormatOf,
	IsEligibleCrdtSetField,
	IsEligibleCrdtTextField,
} from "#questpie/server/fields/field-class-types.js";
import { text } from "#questpie/server/modules/core/fields/text.js";
import { textarea } from "#questpie/server/modules/core/fields/textarea.js";

import type { Equal, Expect } from "./type-test-utils.js";

const collaborativeText = textarea()
	.default("")
	.required()
	.crdt({ format: "text" });
const collaborativeSet = text({ mode: "text" })
	.array()
	.default([])
	.required()
	.crdt({ format: "set", conflict: "add-wins" });

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
const invalidBoundedText = text()
	.default("")
	.required()
	.crdt({ format: "text" });
const invalidScalarSet = text({ mode: "text" })
	.default("")
	.required()
	.crdt({ format: "set", conflict: "add-wins" });

type _eligibleAfter = Expect<
	Equal<IsEligibleCrdtTextField<typeof collaborativeText>, true>
>;
type _eligibleSet = Expect<
	Equal<IsEligibleCrdtSetField<typeof collaborativeSet>, true>
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
type _boundedTextRejected = Expect<
	Equal<IsEligibleCrdtTextField<typeof invalidBoundedText>, false>
>;
type _scalarSetRejected = Expect<
	Equal<IsEligibleCrdtSetField<typeof invalidScalarSet>, false>
>;
type _textFormat = Expect<
	Equal<CrdtFormatOf<typeof collaborativeText>, "text">
>;
type _setFormat = Expect<Equal<CrdtFormatOf<typeof collaborativeSet>, "set">>;
