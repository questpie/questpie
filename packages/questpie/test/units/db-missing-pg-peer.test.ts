import { expect, test } from "bun:test";

// Use a separate process so the missing peer cannot poison other adapter tests.
test("node-postgres names the driver and optional pg peer when pg cannot load", async () => {
	const serviceUrl = new URL(
		"../../src/server/modules/core/services/db.ts",
		import.meta.url,
	).href;
	const source = `
		import { mock } from "bun:test";
		mock.module("pg", () => { throw new Error("simulated missing pg peer"); });
		const { default: dbService } = await import(${JSON.stringify(serviceUrl)});
		try {
			await dbService.state.create({ app: {
				config: { db: { url: "postgres://unused/unused", driver: "node-postgres" } },
				getSchema: () => ({}),
			} });
			process.exit(1);
		} catch (error) {
			console.log(error.message);
		}
	`;
	const child = Bun.spawn([process.execPath, "--eval", source], {
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, output, error] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	expect(error).toBe("");
	expect(code).toBe(0);
	expect(output).toContain('driver "node-postgres"');
	expect(output).toContain('optional "pg" peer dependency');
	expect(output).toContain("bun add pg");
});
