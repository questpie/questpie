import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";

const CLI_PATH = resolve(import.meta.dirname, "../../bin/questpie.mjs");

describe("CLI binary", () => {
	it("the packaged bin shim prints help and exits 0", async () => {
		const proc = Bun.spawn(["bun", CLI_PATH, "--help"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const code = await proc.exited;
		const stdout = await new Response(proc.stdout).text();

		expect(code).toBe(0);
		expect(stdout).toContain("Usage: questpie");
		expect(stdout).toContain("Commands:");
	});

	it("the packaged bin shim prints version and exits 0", async () => {
		const proc = Bun.spawn(["bun", CLI_PATH, "--version"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const code = await proc.exited;
		const stdout = await new Response(proc.stdout).text();

		expect(code).toBe(0);
		expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
	});
});
