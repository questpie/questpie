import { describe, expect, it } from "vitest";

import {
	hashContent,
	normalizeKnowledgePath,
} from "../services/knowledge-resource";

describe("knowledge-resource helpers", () => {
	it("normalizes safe resource paths", () => {
		expect(normalizeKnowledgePath("/runs/123//summary.md")).toBe(
			"runs/123/summary.md",
		);
	});

	it("rejects traversal paths", () => {
		expect(() => normalizeKnowledgePath("../secrets.md")).toThrow(
			"Invalid knowledge path",
		);
	});

	it("calculates stable content hashes", () => {
		expect(hashContent("hello")).toBe(hashContent("hello"));
		expect(hashContent("hello")).not.toBe(hashContent("world"));
	});
});
