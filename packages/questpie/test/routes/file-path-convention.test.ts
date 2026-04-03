/**
 * QUE-272: File-path to route pattern convention tests
 */
import { describe, expect, it } from "bun:test";

import {
	filePathToRoutePattern,
	routePatternToFilePath,
} from "../../src/server/routes/file-path-convention.js";

describe("filePathToRoutePattern", () => {
	it("literal segments pass through", () => {
		expect(filePathToRoutePattern("admin/stats")).toBe("admin/stats");
	});

	it("[param] → :param", () => {
		expect(filePathToRoutePattern("users/[id]")).toBe("users/:id");
	});

	it("multiple params", () => {
		expect(filePathToRoutePattern("users/[userId]/posts/[postId]")).toBe(
			"users/:userId/posts/:postId",
		);
	});

	it("[...slug] → *slug", () => {
		expect(filePathToRoutePattern("files/[...path]")).toBe("files/*path");
	});

	it("mixed literals, params, and catch-all", () => {
		expect(filePathToRoutePattern("api/[version]/docs/[...rest]")).toBe(
			"api/:version/docs/*rest",
		);
	});

	it("single segment param", () => {
		expect(filePathToRoutePattern("[collection]")).toBe(":collection");
	});

	it("single segment catch-all", () => {
		expect(filePathToRoutePattern("[...all]")).toBe("*all");
	});

	it("nested literal path", () => {
		expect(filePathToRoutePattern("admin/dashboard/widgets")).toBe(
			"admin/dashboard/widgets",
		);
	});
});

describe("routePatternToFilePath (inverse)", () => {
	it(":param → [param]", () => {
		expect(routePatternToFilePath("users/:id")).toBe("users/[id]");
	});

	it("*slug → [...slug]", () => {
		expect(routePatternToFilePath("files/*path")).toBe("files/[...path]");
	});

	it("round-trip", () => {
		const original = "api/[version]/docs/[...rest]";
		expect(routePatternToFilePath(filePathToRoutePattern(original))).toBe(
			original,
		);
	});
});
