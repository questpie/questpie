import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

const fixture = resolve(import.meta.dir, "../../fixtures/team-support-desk");

test("renders the Team Support Desk OpenAPI projection through Scalar", async () => {
	const directory = await mkdtemp(join(tmpdir(), "questpie-scalar-"));
	try {
		await cp(fixture, directory, { recursive: true });
		const compilation = await compileApplication({
			applicationRoot: directory,
		});
		const openapi = JSON.parse(compilation.generatedFiles["openapi.json"]!);
		expect(openapi).toMatchObject({
			info: { title: "teamSupportDesk" },
			openapi: "3.1.0",
		});
		expect(Object.keys(openapi.paths)).toContain(
			"/_questpie/query/tickets.queue",
		);
		expect(Object.keys(openapi.paths)).toContain(
			"/_questpie/mutation/ticket.assign",
		);

		const scalar = await readFile(
			join(directory, "tracer/scalar.html"),
			"utf8",
		);
		expect(scalar).toContain("@scalar/api-reference@1.67.0");
		expect(scalar).toContain('url: "/openapi.json"');
		const host = await readFile(join(directory, "tracer/host.ts"), "utf8");
		expect(host).toContain('url.pathname === "/api-reference"');
		expect(host).toContain('url.pathname === "/openapi.json"');
	} finally {
		await rm(directory, { force: true, recursive: true });
	}
});
