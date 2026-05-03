import { describe, expect, it } from "bun:test";

import { isPreviewToAdminMessage } from "#questpie/admin/client/preview/types";

describe("isPreviewToAdminMessage", () => {
	it("accepts block insert requests with a valid tree position", () => {
		expect(
			isPreviewToAdminMessage({
				type: "BLOCK_INSERT_REQUESTED",
				position: { parentId: null, index: 1 },
				referenceBlockId: "hero-1",
			}),
		).toBe(true);

		expect(
			isPreviewToAdminMessage({
				type: "BLOCK_INSERT_REQUESTED",
				position: { parentId: "columns-1", index: 0 },
			}),
		).toBe(true);
	});

	it("rejects invalid block insert positions", () => {
		expect(
			isPreviewToAdminMessage({
				type: "BLOCK_INSERT_REQUESTED",
				position: { parentId: null, index: -1 },
			}),
		).toBe(false);

		expect(
			isPreviewToAdminMessage({
				type: "BLOCK_INSERT_REQUESTED",
				position: { parentId: 42, index: 0 },
			}),
		).toBe(false);
	});
});
