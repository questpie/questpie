import { describe, expect, test } from "bun:test";

import changesetConfig from "../.changeset/config.json";
import adminPackageJson from "../packages/admin/package.json";
import crdtYjsPackageJson from "../packages/crdt-yjs/package.json";
import elysiaPackageJson from "../packages/elysia/package.json";
import honoPackageJson from "../packages/hono/package.json";
import mcpPackageJson from "../packages/mcp/package.json";
import nextPackageJson from "../packages/next/package.json";
import openApiPackageJson from "../packages/openapi/package.json";
import questpiePackageJson from "../packages/questpie/package.json";
import sandboxPackageJson from "../packages/sandbox/package.json";
import tanstackDbPackageJson from "../packages/tanstack-db/package.json";
import tanstackQueryPackageJson from "../packages/tanstack-query/package.json";
import workflowsPackageJson from "../packages/workflows/package.json";
import {
	assertNoWorkspaceProtocols,
	replaceWorkspaceVersions,
} from "./publish-manifest";

describe("publish manifest workspace dependencies", () => {
	test("resolves @questpie/mcp's questpie dependency before publish", () => {
		const versions = new Map([["questpie", "3.15.0"]]);
		const dependencies = replaceWorkspaceVersions(
			mcpPackageJson.dependencies,
			versions,
		);
		const peerDependencies = replaceWorkspaceVersions(
			mcpPackageJson.peerDependencies,
			versions,
		);

		expect(dependencies?.questpie).toBe("^3.15.0");
		assertNoWorkspaceProtocols({
			...mcpPackageJson,
			dependencies,
			peerDependencies,
		});
	});

	test("pins every fixed-group peer to the versioned Questpie train", () => {
		const questpieCompanions = [
			crdtYjsPackageJson,
			elysiaPackageJson,
			honoPackageJson,
			mcpPackageJson,
			nextPackageJson,
			openApiPackageJson,
			sandboxPackageJson,
			tanstackDbPackageJson,
			tanstackQueryPackageJson,
			workflowsPackageJson,
		];

		for (const manifest of questpieCompanions) {
			expect(manifest.peerDependencies.questpie).toBe("workspace:^");
			expect(
				replaceWorkspaceVersions(
					manifest.peerDependencies,
					new Map([["questpie", "3.17.0"]]),
				)?.questpie,
			).toBe("^3.17.0");
		}
		expect(workflowsPackageJson.peerDependencies["@questpie/admin"]).toBe(
			"workspace:^",
		);
		expect(
			replaceWorkspaceVersions(
				workflowsPackageJson.peerDependencies,
				new Map([
					["questpie", "3.17.0"],
					["@questpie/admin", "3.17.0"],
				]),
			),
		).toMatchObject({
			"@questpie/admin": "^3.17.0",
			questpie: "^3.17.0",
		});
		expect(adminPackageJson.version).toBe(questpiePackageJson.version);
		expect(
			changesetConfig.___experimentalUnsafeOptions_WILL_CHANGE_IN_PATCH
				.onlyUpdatePeerDependentsWhenOutOfRange,
		).toBe(true);
	});

	test("rejects a manifest that would publish a workspace protocol", () => {
		expect(() => assertNoWorkspaceProtocols(mcpPackageJson)).toThrow(
			"dependencies.questpie=workspace:*",
		);
	});
});
