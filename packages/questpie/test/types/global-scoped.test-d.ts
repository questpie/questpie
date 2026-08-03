/**
 * `scoped` reads a key your own middleware put on the context. That is what it
 * is for. It used to be typed against `BaseRequestContext`, an interface with
 * no augmentation seam and no index signature, so the JSDoc's own example did
 * not compile and every real use needed a cast.
 *
 * This asserts the parameter shape rather than augmenting `Questpie.AppContext`
 * for real. `declare global` in a test file leaks into the whole project
 * typecheck, and a non-empty AppContext broke an unrelated cast in
 * modules/core/services/crdt.ts.
 */
import type { AppContext } from "../../src/server/config/app-context.js";
import type { BaseRequestContext } from "../../src/server/config/context.js";
import type { GlobalScopeResolver } from "../../src/server/global/builder/types.js";
import type { Equal, Expect } from "./type-test-utils.js";

type ScopedParam = Parameters<GlobalScopeResolver>[0];

/* The parameter carries AppContext, so a project that augments
   `declare global { namespace Questpie { interface AppContext { tenantId } } }`
   reads `ctx.tenantId` with no cast. */
export type _CarriesAppContext = Expect<
	Equal<ScopedParam, BaseRequestContext & AppContext>
>;

/* Base-context keys still resolve. */
export const bySession: GlobalScopeResolver = (ctx) =>
	ctx.session?.user.id ?? null;

/* A key nobody declared is still rejected. */
// @ts-expect-error not on the context
export const bogus: GlobalScopeResolver = (ctx) => ctx.notAKeyAnyoneDeclared;
