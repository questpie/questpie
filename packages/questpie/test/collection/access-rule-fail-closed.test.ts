/**
 * An access rule shape the type system does not admit must DENY, not allow.
 *
 * `AccessRule` is `boolean | ((ctx) => boolean | AccessWhere)`. Anything else —
 * an object, a string, a number — can only arrive from untyped JS, a cast, or
 * config deserialized at runtime. Both collection evaluators used to end with
 * an unconditional allow for that case:
 *
 *   executeAccessRule  (crud/shared/access-control.ts)  ->  return true
 *   evaluateAccessRule (introspection.ts)               ->  { allowed: true }
 *
 * So the one branch nobody can type-check was the one branch that granted
 * access, on the enforcement path. Globals were made fail-closed in af34e638;
 * this pins the same behaviour for collections and keeps the three evaluators
 * from drifting apart again.
 *
 * Driving the exported `executeAccessRule` directly: it is the function every
 * CRUD operation funnels through, so this is the enforcement seam itself
 * rather than a proxy for it.
 */
import { describe, expect, it } from "bun:test";

import { executeAccessRule } from "../../src/server/collection/crud/shared/access-control.js";

const ctx = { session: { user: { id: "u1" } } } as any;

describe("executeAccessRule fails closed", () => {
	it("denies an object rule", async () => {
		// The shape someone reaches for when they confuse the RULE with the
		// AccessWhere a rule may RETURN.
		expect(await executeAccessRule({ tenantId: "t1" } as any, ctx)).toBe(false);
	});

	it("denies a string rule", async () => {
		expect(await executeAccessRule("admin" as any, ctx)).toBe(false);
	});

	it("denies a number rule", async () => {
		expect(await executeAccessRule(1 as any, ctx)).toBe(false);
	});

	it("still honours the shapes that are typed", async () => {
		expect(await executeAccessRule(true, ctx)).toBe(true);
		expect(await executeAccessRule(false, ctx)).toBe(false);
		expect(await executeAccessRule(() => true, ctx)).toBe(true);
		// undefined means "require a session", not "deny"
		expect(await executeAccessRule(undefined, ctx)).toBe(true);
		expect(await executeAccessRule(undefined, { session: null } as any)).toBe(
			false,
		);
	});
});
