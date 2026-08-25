import { expect, test } from "bun:test";

import type {
	JobAcceptance,
	LinkedJobMember,
	LinkedJobProjection,
	LinkedReactionProjection,
} from "../../packages/runtime/src/durable";
import { createDurableDispatch } from "../../packages/runtime/src/mutation/dispatch";

const job = Object.freeze({
	identity: "job:reports.companyDigest",
	member: "reports.companyDigest",
}) as LinkedJobMember;

test("Mutation Job capabilities use the same nested-only server shape", async () => {
	const accepted: unknown[] = [];
	const jobAcceptance: JobAcceptance = {
		async accept(target, payload, options) {
			accepted.push({ target, payload, options });
			return Object.freeze({
				runId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0",
				resource: target.identity as `job:${string}`,
			});
		},
	};
	const capabilities = createDurableDispatch(
		{ members: new Map() } as LinkedReactionProjection,
		{
			members: new Map([[job.member, job]]),
			byIdentity: new Map([[job.identity, job]]),
		} satisfies LinkedJobProjection,
		jobAcceptance,
	).jobs;

	expect(Object.getPrototypeOf(capabilities)).toBeNull();
	expect(Object.hasOwn(capabilities, "reports.companyDigest")).toBe(false);
	const reports = capabilities.reports as Readonly<
		Record<string, Readonly<{ accept: JobAcceptance["accept"] }>>
	>;
	expect(Object.getPrototypeOf(reports)).toBeNull();
	expect(Object.isFrozen(capabilities)).toBe(true);
	expect(Object.isFrozen(reports)).toBe(true);
	await expect(
		reports.companyDigest!.accept(
			{ companyId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a1" },
			{ idempotencyKey: "digest:primary" },
		),
	).resolves.toMatchObject({ resource: job.identity });
	expect(accepted).toHaveLength(1);
});
