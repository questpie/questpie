// Cross-feature rule from the 2026-09-22 integration of ADR-0047 (the
// Collection `delete` kernel, `work/collection-delete-kernel`) and ADR-0048
// (compiler-owned database-level immutability, `work/collection-db-immutability`).
//
// Neither branch could know about the other: ADR-0048 shipped a compose-time
// refusal (QP-COMPOSE-013) for the auto-generated `update` kernel on an
// append-only Collection (`packages/compiler/src/mutation/kernel.ts`), and a
// separate generic refusal for an authored Operation Set `update`/`delete`
// member (`packages/compiler/src/mutation/operation-set.ts`) — the latter
// already covered `delete` textually even though no delete kernel existed
// yet on that branch. ADR-0047 then added the `delete` kernel itself. This
// file proves the same kernel-level refusal ADR-0048 proved for `update`
// now also holds for the NEW `delete` kernel: an append-only Collection
// yields no `delete` kernel, and a Policy declaring a `delete` operation on
// it is the same compose-time diagnostic — mirroring
// `tests/unit/adr0048-immutability-guards.test.ts`'s
// "refuses a Policy update operation on an append-only Collection even
// without an explicit Operation Set" and
// "a create-only Policy on an append-only Collection compiles and generates
// no update kernel" tests.

import { describe, expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

describe("ADR-0047 delete kernel x ADR-0048 append-only refusal", () => {
	test("refuses a Policy delete operation on an append-only Collection even without an explicit Operation Set (the auto-generated Collection Mutation Kernel)", async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-immutability-delete-kernel-"),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/append-only-delete-kernel-fixture.ts"),
				`import { constraint, defineCollection, definePolicy, field, policy } from "questpie";

export const evidenceEntries = defineCollection({
	name: "evidenceEntries",
	appendOnly: true,
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		label: field.text({ nullable: false }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

export const evidenceEntriesPolicy = definePolicy(evidenceEntries, {
	name: "evidenceEntries.default",
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate }) => candidate.id.equal(candidate.id),
	},
	delete: {
		admit: policy.authenticated(),
		rows: ({ current }) => current.id.equal(current.id),
		validate: ({ current }) => current.id.equal(current.id),
	},
	fields: {
		create: ({ candidate }) => ({
			id: candidate.id.equal(candidate.id),
			label: candidate.label.equal(candidate.label),
		}),
	},
});
`,
			);
			await expect(
				compileApplication({ applicationRoot: temporary }),
			).rejects.toMatchObject({
				code: "QP-COMPOSE-013",
				diagnosticClass: "structuralTypeError",
				message: expect.stringContaining(
					"collection:evidenceEntries cannot declare a Policy delete operation: it is append-only",
				),
			});
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	test("a create-only Policy on an append-only Collection compiles and generates no delete kernel", async () => {
		const temporary = await mkdtemp(
			join(tmpdir(), "questpie-immutability-delete-kernel-create-"),
		);
		try {
			await cp(fixtureRoot, temporary, { recursive: true });
			await writeFile(
				join(temporary, "src/append-only-delete-kernel-create-fixture.ts"),
				`import { constraint, defineCollection, definePolicy, field, policy } from "questpie";

export const evidenceEntries = defineCollection({
	name: "evidenceEntries",
	appendOnly: true,
	fields: {
		id: field.uuid({ nullable: false, default: "randomUuid" }),
		label: field.text({ nullable: false }),
	},
	constraints: { primary: constraint.primaryKey({ fields: ["id"] }) },
});

export const evidenceEntriesPolicy = definePolicy(evidenceEntries, {
	name: "evidenceEntries.default",
	create: {
		admit: policy.authenticated(),
		candidate: ({ candidate }) => candidate.id.equal(candidate.id),
	},
	fields: {
		create: ({ candidate }) => ({
			id: candidate.id.equal(candidate.id),
			label: candidate.label.equal(candidate.label),
		}),
	},
});
`,
			);
			const compilation = await compileApplication({
				applicationRoot: temporary,
			});
			const operationPrograms = JSON.parse(
				compilation.generatedFiles["collection-operation-programs.json"] ??
					"null",
			) as { operations: Array<{ identity: string }> };
			const kernelIdentities = operationPrograms.operations
				.map((entry) => entry.identity)
				.filter((identity) => identity.includes("evidenceEntries"));
			expect(kernelIdentities).toContain(
				"mutation:__collectionKernel.evidenceEntries.create",
			);
			expect(
				kernelIdentities.some((identity) => identity.includes(".delete")),
			).toBe(false);
			expect(
				kernelIdentities.some((identity) => identity.includes(".update")),
			).toBe(false);
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	// The authored-Operation-Set-`delete`-member half of this rule was
	// already covered before this integration by
	// `tests/unit/adr0048-immutability-guards.test.ts`'s
	// "refuses a delete Mutation member on an append-only Collection as a
	// compiler diagnostic" test — that generic `operation-set.ts` check
	// named `delete` in its member list even before the delete kernel
	// existed on `work/collection-delete-kernel`, and it still passes
	// unchanged after this merge. Not duplicated here.
});
