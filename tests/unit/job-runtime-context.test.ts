import { expect, test } from "bun:test";

import { createDurableJobContext } from "../../packages/runtime/src/durable";

test("projects only ordinary Execution facts into a Job handler context", () => {
	const principal = Object.freeze({ kind: "user", id: "user:one" });
	const authority = Object.freeze({ kind: "ordinary" });
	const tenant = Object.freeze({ id: "tenant:one" });
	const values = Object.freeze({ membership: "member" });
	const signal = new AbortController().signal;
	const run = Object.freeze({ id: "run:one" });
	const attempt = Object.freeze({
		number: 1,
		heartbeat: async () => undefined,
	});
	const context = createDurableJobContext(
		Object.freeze({
			principal,
			authority,
			tenant,
			values,
			services: Object.freeze({ secret: true }),
			actionScope: Object.freeze({ invoke: true }),
			actions: Object.freeze({ delivery: true }),
			signal,
			deadline: 1_800_000_000_000,
		}),
		run,
		attempt,
	);

	expect(context).toEqual({
		principal,
		authority,
		tenant,
		values,
		signal,
		deadline: 1_800_000_000_000,
		run,
		attempt,
	});
	expect(Object.hasOwn(context, "services")).toBe(false);
	expect(Object.hasOwn(context, "actionScope")).toBe(false);
	expect(Object.hasOwn(context, "actions")).toBe(false);
	expect(Object.isFrozen(context)).toBe(true);
});
