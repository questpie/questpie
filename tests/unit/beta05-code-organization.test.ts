import { expect, test } from "bun:test";
import { resolve } from "node:path";

const compilerRuntime = resolve(
	import.meta.dir,
	"../../packages/compiler/src/runtime",
);

test("keeps PostgreSQL readiness behind one concrete runtime module", async () => {
	const applicationRenderer = await Bun.file(
		resolve(compilerRuntime, "application.ts"),
	).text();
	expect(applicationRenderer).not.toContain("schema_migration_receipts");
	expect(applicationRenderer).not.toContain("application_bindings");

	const readinessFile = Bun.file(
		resolve(compilerRuntime, "postgres-readiness.ts"),
	);
	expect(await readinessFile.exists()).toBe(true);
	const readiness = await readinessFile.text();
	expect(readiness).toContain(
		"export async function verifyPostgresRuntimeReadiness",
	);
});
