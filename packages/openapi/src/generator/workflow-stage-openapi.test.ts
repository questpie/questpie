import { describe, expect, it } from "bun:test";
import { generateOpenApiSpec } from "./index.js";

function hasStageParameter(operation: any): boolean {
	if (!operation || !Array.isArray(operation.parameters)) {
		return false;
	}

	return operation.parameters.some(
		(param: any) => param?.name === "stage" && param?.in === "query",
	);
}

describe("OpenAPI workflow stage parameters", () => {
	it("includes stage query params on workflow-aware endpoints", () => {
		const app = {
			getCollections: () => ({
				posts: {
					state: {
						fieldDefinitions: {},
						options: { softDelete: true },
						validation: {},
					},
				},
			}),
			getGlobals: () => ({
				siteSettings: {
					state: {
						fieldDefinitions: {},
						options: {},
						validation: {},
					},
				},
			}),
		} as any;

		const spec = generateOpenApiSpec(app, undefined, {
			basePath: "/api",
		});

		expect(hasStageParameter(spec.paths["/api/posts"]?.get)).toBe(true);
		expect(hasStageParameter(spec.paths["/api/posts"]?.post)).toBe(true);
		expect(hasStageParameter(spec.paths["/api/posts/{id}"]?.get)).toBe(true);
		expect(hasStageParameter(spec.paths["/api/posts/{id}"]?.patch)).toBe(true);
		expect(hasStageParameter(spec.paths["/api/posts/{id}"]?.delete)).toBe(true);
		expect(hasStageParameter(spec.paths["/api/posts/{id}/revert"]?.post)).toBe(
			true,
		);

		expect(
			hasStageParameter(spec.paths["/api/globals/siteSettings"]?.get),
		).toBe(true);
		expect(
			hasStageParameter(spec.paths["/api/globals/siteSettings"]?.patch),
		).toBe(true);
		expect(
			hasStageParameter(spec.paths["/api/globals/siteSettings/revert"]?.post),
		).toBe(true);
	});
});
