import { describe, expect, it } from "bun:test";

import { route } from "questpie";
import { z } from "zod";

import { generateRoutePaths } from "./routes.js";

describe("generateRoutePaths — method suffix routes", () => {
	it("emits one operation per method for method-suffixed routes on the same path", () => {
		const authGet = route()
			.get()
			.raw()
			.handler(() => new Response("ok"));
		const authPost = route()
			.post()
			.raw()
			.handler(() => new Response("ok"));

		const routes = {
			"auth/[...path]:GET": authGet,
			"auth/[...path]:POST": authPost,
		} as any;

		let result: ReturnType<typeof generateRoutePaths> | undefined;
		expect(() => {
			result = generateRoutePaths(routes, { basePath: "/api" });
		}).not.toThrow();

		const pathItem = result!.paths["/api/auth/{path}"];
		expect(pathItem).toBeDefined();
		// Both methods present on the SAME path object (not overwritten).
		expect(pathItem.get).toBeDefined();
		expect(pathItem.post).toBeDefined();
		// `[...path]` → `{path}` template, no `[...path]` literal in the key.
		expect(Object.keys(result!.paths)).toEqual(["/api/auth/{path}"]);
		// Unique operationIds across the two methods.
		expect((pathItem.get as any).operationId).not.toBe(
			(pathItem.post as any).operationId,
		);
	});

	it("splits a trailing :METHOD key suffix into the method and path", () => {
		// A route registered under a `<path>:METHOD` key (e.g. generated module keys).
		const createItem = route()
			.post()
			.schema(z.object({ name: z.string() }))
			.handler(() => ({ ok: true }));

		const routes = {
			"items:POST": createItem,
		} as any;

		const result = generateRoutePaths(routes, { basePath: "/api" });

		// Path has no `:POST` literal; the suffix became the method.
		expect(result.paths["/api/items"]).toBeDefined();
		expect(result.paths["/api/items"].post).toBeDefined();
		expect(Object.keys(result.paths)).toEqual(["/api/items"]);
		expect(Object.keys(result.paths).some((p) => p.includes(":POST"))).toBe(
			false,
		);
	});

	it("converts [param] and [...slug] segments to {param} templates with path parameters", () => {
		const getOne = route()
			.get()
			.schema(z.object({}))
			.handler(() => ({ ok: true }));
		const getFile = route()
			.get()
			.raw()
			.handler(() => new Response("ok"));

		const routes = {
			users: {
				"[id]": getOne,
			},
			files: {
				"[...key]": getFile,
			},
		} as any;

		const result = generateRoutePaths(routes, { basePath: "/api" });

		const userPath = result.paths["/api/users/{id}"];
		expect(userPath).toBeDefined();
		expect(userPath.get).toBeDefined();
		expect((userPath.get as any).parameters).toEqual([
			{ name: "id", in: "path", required: true, schema: { type: "string" } },
		]);

		const filePath = result.paths["/api/files/{key}"];
		expect(filePath).toBeDefined();
		expect(filePath.get).toBeDefined();
		expect((filePath.get as any).parameters).toEqual([
			{ name: "key", in: "path", required: true, schema: { type: "string" } },
		]);
	});
});
