import { describe, expect, test } from "bun:test";

import mcpPackageJson from "../packages/mcp/package.json";
import {
	assertNoWorkspaceProtocols,
	replaceWorkspaceVersions,
} from "./publish-manifest";

describe("publish manifest workspace dependencies", () => {
	test("resolves @questpie/mcp's questpie dependency before publish", () => {
		const dependencies = replaceWorkspaceVersions(
			mcpPackageJson.dependencies,
			new Map([["questpie", "3.15.0"]]),
		);

		expect(dependencies?.questpie).toBe("^3.15.0");
		assertNoWorkspaceProtocols({
			...mcpPackageJson,
			dependencies,
		});
	});

	test("rejects a manifest that would publish a workspace protocol", () => {
		expect(() => assertNoWorkspaceProtocols(mcpPackageJson)).toThrow(
			"dependencies.questpie=workspace:*",
		);
	});
});
