import type { FieldState } from "#questpie/server/fields/field-class-types.js";
import { select } from "#questpie/server/modules/core/fields/select.js";

const sa = select([
  { value: "a", label: { en: "A" } },
  { value: "b", label: { en: "B" } },
]).array();
type SAState = typeof sa extends { readonly _: infer S extends FieldState } ? S : never;

// Does the array state carry whereInput?
type HasWhereInput = SAState extends { whereInput: infer WI } ? WI : "NO_WHEREINPUT";
type HasIsArray = SAState extends { isArray: true } ? true : false;
type HasInnerState = SAState extends { innerState: infer I } ? true : false;

const _wi: HasWhereInput = "NO_WHEREINPUT"; // compiles IFF no whereInput on array state
const _ia: HasIsArray = true;
const _is: HasInnerState = true;
