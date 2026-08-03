/**
 * `scoped` reads a key your own middleware put on the context. That is what it
 * is for. It used to be typed against `BaseRequestContext`, an interface with
 * no augmentation seam and no index signature, so the JSDoc's own example did
 * not compile and every real use needed a cast.
 */
import type { GlobalScopeResolver } from "../../src/server/global/builder/types.js";

declare global {
	namespace Questpie {
		interface AppContext {
			tenantId: string | null;
		}
	}
}

// The example from the JSDoc on `scoped`, with no cast.
export const byTenant: GlobalScopeResolver = (ctx) => ctx.tenantId;

// Keys from the base context still resolve.
export const bySession: GlobalScopeResolver = (ctx) =>
	ctx.session?.user.id ?? null;

// A key nobody declared is still rejected.
// @ts-expect-error not on the context
export const bogus: GlobalScopeResolver = (ctx) => ctx.notAKeyAnyoneDeclared;
