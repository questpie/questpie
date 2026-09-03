import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { createScalarConfiguration } from "../../fixtures/team-support-desk/tracer/scalar-configuration.js";

const fixture = resolve(import.meta.dir, "../../fixtures/team-support-desk");

test("runs the compact Scalar carrier through its caller-facing configuration", async () => {
	const openapi = {
		paths: {
			"/_questpie/query/tickets.queue": {
				get: {
					parameters: [
						{ in: "header", name: "Questpie-Call-Id", schema: {} },
						{ in: "header", name: "Questpie-Context", schema: {} },
						{
							in: "header",
							name: "Questpie-Timeout-Milliseconds",
							schema: {},
						},
						{
							in: "header",
							name: "Questpie-Application",
							schema: { default: "application:teamSupportDesk" },
						},
						{
							in: "header",
							name: "Questpie-Client-Contract",
							schema: { default: "client-digest" },
						},
						{
							in: "header",
							name: "Questpie-Wire-Digest",
							schema: { default: "wire-digest" },
						},
						{ in: "query", name: "first", schema: { type: "integer" } },
					],
				},
			},
		},
	};
	const configuration = createScalarConfiguration(openapi);
	const visibleQuery =
		configuration.content.paths["/_questpie/query/tickets.queue"].get;
	const visibleHeaderNames = visibleQuery.parameters
		.filter(({ in: location }) => location === "header")
		.map(({ name }) => name);
	expect(visibleHeaderNames).toEqual([
		"Questpie-Call-Id",
		"Questpie-Context",
		"Questpie-Timeout-Milliseconds",
	]);
	const headers = new Headers();
	configuration.onBeforeRequest({ requestBuilder: { headers } });
	expect(Object.fromEntries(headers)).toEqual({
		"questpie-application": "application:teamSupportDesk",
		"questpie-client-contract": "client-digest",
		"questpie-wire-digest": "wire-digest",
	});
	expect(
		openapi.paths["/_questpie/query/tickets.queue"].get.parameters,
	).toContainEqual(expect.objectContaining({ name: "Questpie-Application" }));

	const scalar = await readFile(join(fixture, "tracer/scalar.html"), "utf8");
	expect(scalar).toContain("@scalar/api-reference@1.67.0");
	expect(scalar).toContain('fetch("/openapi.json")');
	expect(scalar).toContain("createScalarConfiguration(document)");
	expect(scalar).not.toContain("client-digest");
	const host = await readFile(join(fixture, "tracer/host.ts"), "utf8");
	expect(host).toContain('url.pathname === "/api-reference"');
	expect(host).toContain('url.pathname === "/scalar-configuration.js"');
	expect(host).toContain('url.pathname === "/openapi.json"');
});
