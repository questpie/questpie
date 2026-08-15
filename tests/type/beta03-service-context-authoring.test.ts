import { expect, test } from "bun:test";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

test("types Service dependency edges and Context capabilities before projection", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-beta03-types-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		await writeFile(
			join(temporary, "src/service-context-types.ts"),
			`import { codec, defineContext, defineService } from "questpie";
import type { Principal } from "questpie";
import { companies } from "./companies";

// @ts-expect-error Principal values are created by trusted principal factories
const forgedPrincipal: Principal = { questpiePrincipal: true, kind: "user", id: "forged" };
void forgedPrincipal;

export const applicationRead = defineService({
	name: "types.applicationRead",
	lifetime: "application",
	effect: "read",
	create: () => ({ count: 1 }),
});
export const executionRead = defineService({
	name: "types.executionRead",
	lifetime: "execution",
	effect: "read",
	create: () => ({ count: 2 }),
});
export const applicationExternal = defineService({
	name: "types.applicationExternal",
	lifetime: "application",
	effect: "external",
	create: () => ({ send: () => true }),
});

export const inferred = defineService({
	name: "types.inferred",
	lifetime: "execution",
	effect: "read",
	dependencies: { applicationRead },
	create: ({ services }) => ({ count: services.applicationRead.count + 1 }),
});

defineService({
	name: "types.invalidLifetime",
	lifetime: "application",
	effect: "read",
	// @ts-expect-error application lifetime cannot capture execution lifetime
	dependencies: { executionRead },
	create: () => null,
});
defineService({
	name: "types.invalidEffect",
	lifetime: "execution",
	effect: "read",
	// @ts-expect-error a read Service cannot hide an external effect
	dependencies: { applicationExternal },
	create: () => null,
});

const typedContext = defineContext({
	name: "types.context",
	input: codec.object({ companyId: codec.uuid() }),
	resolve: async ({ input, principal, bootstrap }) => {
		const companyId: string = input.companyId;
		const principalId: string = principal.id;
		const company = await bootstrap.get(companies, {
			key: { id: companyId },
			select: { name: true },
		});
		const companyName: string | undefined = company?.name;
		// @ts-expect-error bootstrap selection is exact to the Collection
		await bootstrap.get(companies, { key: { id: companyId }, select: { missing: true } });
		// @ts-expect-error Context Resolution cannot access Services
		void bootstrap.services;
		return {
			tenant: { id: companyId },
			values: { principalId, companyName },
		};
	},
});
void typedContext;
`,
		);

		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		const services = JSON.parse(
			compilation.generatedFiles["service-projection.json"] ?? "null",
		);
		const context = JSON.parse(
			compilation.generatedFiles["context-projection.json"] ?? "null",
		);
		expect(
			services.services.find(
				(service: { identity: string }) =>
					service.identity === "service:types.inferred",
			),
		).toEqual({
			identity: "service:types.inferred",
			owner: { kind: "application" },
			lifetime: "execution",
			effect: "read",
			dependencies: ["service:types.applicationRead"],
			executableSlots: ["create"],
		});
		expect(context.context).toMatchObject({
			identity: "context:app.context",
			owner: { kind: "application" },
			immutable: true,
		});
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
});
