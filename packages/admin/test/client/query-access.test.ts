import { describe, expect, it } from "bun:test";

import { adminCollectionKey } from "../../src/client/hooks/query-access";

describe("adminCollectionKey", () => {
	it("returns the same runtime string for route-derived collection names", () => {
		expect(adminCollectionKey("posts")).toBe("posts");
		expect(adminCollectionKey("workflow_configs")).toBe("workflow_configs");
	});
});
