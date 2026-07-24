import { describe, expect, it } from "bun:test";

import { generateOpenApiSpec } from "./index.js";

describe("OpenAPI physical purge contract", () => {
	it("emits purge only for soft-delete collections", async () => {
		const app = {
			getCollections: () => ({
				archive: {
					state: {
						fieldDefinitions: {},
						options: { softDelete: true },
						validation: {},
					},
				},
				ephemeral: {
					state: {
						fieldDefinitions: {},
						options: {},
						validation: {},
					},
				},
			}),
			getGlobals: () => ({}),
		} as any;

		const spec = await generateOpenApiSpec(app, undefined, {
			basePath: "/api",
		});

		expect(spec.paths["/api/archive/{id}/purge"]?.post).toMatchObject({
			operationId: "archive_purge",
			parameters: [
				{
					name: "id",
					in: "path",
					required: true,
				},
			],
		});
		expect(spec.paths["/api/ephemeral/{id}/purge"]).toBeUndefined();
	});
});
