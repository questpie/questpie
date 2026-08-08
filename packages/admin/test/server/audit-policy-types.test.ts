import { afterEach, describe, expect, expectTypeOf, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { runCodegen } from "../../../questpie/src/cli/codegen/index.js";
import auditPlugin from "../../src/server/modules/audit/plugin.js";
import type {
	AuditActorIdentity,
	AuditFieldPolicy,
	AuditPolicy,
	CanonicalAuditEvent,
} from "../../src/server/modules/audit/policy.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("audit policy types", () => {
	it("exposes the typed field extension and policy values", () => {
		const values = [
			"include",
			"redact",
			"omit",
		] as const satisfies readonly AuditFieldPolicy[];
		const policy = { delivery: "required" } as const satisfies AuditPolicy;
		const extension =
			auditPlugin.targets?.server?.registries?.fieldExtensions?.audit;

		expect(values).toEqual(["include", "redact", "omit"]);
		expect(policy.delivery).toBe("required");
		expect(extension?.stateKey).toBe("audit");
		expect(extension?.configType).toContain("AuditFieldPolicy");

		// @ts-expect-error audit field policies are a closed classification set
		const invalidFieldPolicy: AuditFieldPolicy = "encrypt";
		// @ts-expect-error delivery supports only transaction-required or best-effort
		const invalidDelivery: AuditPolicy = { delivery: "ignore" };
		void invalidFieldPolicy;
		void invalidDelivery;
	});

	it("exposes canonical event and actor identity without any escapes", () => {
		expectTypeOf<AuditActorIdentity["type"]>().toMatchTypeOf<string>();
		expectTypeOf<CanonicalAuditEvent["outcome"]>().toEqualTypeOf<
			"succeeded" | "failed"
		>();
		expectTypeOf<CanonicalAuditEvent["resource"]["id"]>().toEqualTypeOf<
			string | null
		>();
	});

	it("generates consumer factories that reject invalid audit configuration", async () => {
		const packageRoot = resolve(import.meta.dir, "../..");
		const rootDir = await mkdtemp(join(packageRoot, ".audit-policy-types-"));
		temporaryDirectories.push(rootDir);
		const outDir = join(rootDir, ".generated");
		const configPath = join(rootDir, "questpie.config.ts");

		await writeFile(join(rootDir, "modules.ts"), "export default [];\n");
		await writeFile(configPath, "export default {};\n");
		await runCodegen({
			rootDir,
			configPath,
			outDir,
			dryRun: false,
			plugins: [auditPlugin],
		});

		const factoriesPath = join(outDir, "factories.ts");
		const consumerPath = join(rootDir, "consumer.ts");
		const factories = await readFile(factoriesPath, "utf8");
		expect(factories).toContain(
			'audit(config: import("@questpie/admin/modules/audit").AuditFieldPolicy)',
		);
		expect(factories).toContain(
			'function audit<T extends import("@questpie/admin/modules/audit").AuditPolicy>',
		);

		await writeFile(
			consumerPath,
			[
				'import { audit, collection } from "./.generated/factories.js";',
				"",
				'audit({ delivery: "required" });',
				"// @ts-expect-error delivery is a closed policy value",
				'audit({ delivery: "ignore" });',
				"",
				'collection("records").fields(({ f }) => ({',
				'  title: f.text().audit("include").required(),',
				'  secret: f.text().audit("redact"),',
				'  internal: f.text().audit("omit"),',
				"  // @ts-expect-error field classification is a closed policy value",
				'  invalid: f.text().audit("encrypt"),',
				"}));",
				"",
			].join("\n"),
		);

		const tscPath = resolve(packageRoot, "../../node_modules/.bin/tsc");
		const process = Bun.spawn(
			[
				tscPath,
				"--noEmit",
				"--strict",
				"--skipLibCheck",
				"--target",
				"ES2022",
				"--module",
				"ESNext",
				"--moduleResolution",
				"bundler",
				"--types",
				"bun-types",
				factoriesPath,
				consumerPath,
			],
			{ cwd: rootDir, stderr: "pipe", stdout: "pipe" },
		);
		const [exitCode, stdout, stderr] = await Promise.all([
			process.exited,
			new Response(process.stdout).text(),
			new Response(process.stderr).text(),
		]);

		expect(`${stdout}\n${stderr}`).toBe("\n");
		expect(exitCode).toBe(0);
	});
});
