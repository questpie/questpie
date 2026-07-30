/**
 * Select field literal union inference (S5-1)
 */
import type { Field } from "#questpie/server/fields/field-class.js";
import { select } from "#questpie/server/modules/core/fields/select.js";
import type { SelectFieldState } from "#questpie/server/modules/core/fields/select.js";

import type { Equal, Expect, IsLiteral } from "./type-test-utils.js";

const statusOptions = [
	{ value: "draft", label: { en: "Draft" } },
	{ value: "published", label: { en: "Published" } },
	{ value: "archived", label: { en: "Archived" } },
] as const;

const statusField = select(statusOptions);

type StatusFieldState =
	typeof statusField extends Field<infer S extends SelectFieldState>
		? S
		: never;

type StatusValue = StatusFieldState["data"];

type _statusUnion = Expect<
	Equal<StatusValue, "draft" | "published" | "archived">
>;
type _draftIsLiteral = Expect<IsLiteral<Extract<StatusValue, "draft">>>;

const priorityOptions = [
	{ value: 1, label: { en: "Low" } },
	{ value: 2, label: { en: "High" } },
] as const;

const priorityField = select(priorityOptions);

type PriorityFieldState =
	typeof priorityField extends Field<infer S extends SelectFieldState>
		? S
		: never;

type PriorityValue = PriorityFieldState["data"];

type _numericValuesStringified = Expect<Equal<PriorityValue, "1" | "2">>;
