import { describe, expect, test } from "bun:test";

import type { CRUDContext } from "../../src/server/collection/crud/shared/context.js";
import type { GlobalBuilderState } from "../../src/server/global/builder/types.js";
import { resolveGlobalIntrospectionAccess } from "../../src/server/global/introspection.js";

/**
 * A global access rule is typed `boolean | Promise<boolean>` — there is no
 * "filtered" mode, because a global is a single row with no where clause to
 * apply. The collection evaluator, whose rules CAN return a where clause,
 * treats a returned object as `{ allowed: "filtered", where }`.
 *
 * The global evaluator used to do `return result ? allowed : denied`, so any
 * truthy value — including an object a caller meant as a filter — became an
 * unconditional allow. That can only be reached from untyped JS or a cast, but
 * "secure by default" is the stated principle of this file, and failing open on
 * a value the contract does not describe is the wrong direction to fail.
 */
describe("global access rules fail closed on non-boolean results", () => {
	const contextWithoutSession = {
		session: null,
	} as unknown as CRUDContext;

	const stateWith = (read: unknown): GlobalBuilderState =>
		({
			access: { read, update: false },
		}) as unknown as GlobalBuilderState;

	test("an object result denies rather than allowing", async () => {
		// The shape a caller would return if they wrongly assumed globals
		// supported collection-style filtered access.
		const visible = await resolveGlobalIntrospectionAccess(
			stateWith(() => ({ tenantId: "acme" })),
			contextWithoutSession,
		);

		expect(visible).toBe(false);
	});

	test("a truthy non-boolean scalar denies too", async () => {
		const visible = await resolveGlobalIntrospectionAccess(
			stateWith(() => "yes"),
			contextWithoutSession,
		);

		expect(visible).toBe(false);
	});

	test("genuine booleans still work in both directions", async () => {
		await expect(
			resolveGlobalIntrospectionAccess(
				stateWith(() => true),
				contextWithoutSession,
			),
		).resolves.toBe(true);

		await expect(
			resolveGlobalIntrospectionAccess(
				stateWith(() => false),
				contextWithoutSession,
			),
		).resolves.toBe(false);
	});
});
