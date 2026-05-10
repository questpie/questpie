import { describe, expect, it } from "vitest";

import {
	artifactContentPayload,
	legacyArtifactFromResource,
	normalizeLegacyArtifact,
} from "../lib/legacy-run-artifacts";

describe("legacy run artifact helpers", () => {
	it("formats knowledge resources as legacy run artifacts", () => {
		expect(
			legacyArtifactFromResource({
				id: "knowledge-1",
				run: "run-1",
				task: "task-1",
				title: "Result",
				kind: "artifact",
				contentType: "text/markdown",
				body: "# Result",
				metadata: {
					artifactKind: "doc",
					refKind: "inline",
				},
				createdAt: new Date("2026-05-08T09:00:00.000Z"),
			}),
		).toEqual({
			id: "knowledge-1",
			run_id: "run-1",
			task_id: "task-1",
			kind: "doc",
			title: "Result",
			ref_kind: "inline",
			ref_value: "# Result",
			mime_type: "text/markdown",
			metadata: JSON.stringify({
				artifactKind: "doc",
				refKind: "inline",
				knowledgeResourceId: "knowledge-1",
			}),
			blob_id: null,
			created_at: "2026-05-08T09:00:00.000Z",
		});
	});

	it("normalizes legacy inline artifact input for knowledge resources", () => {
		expect(
			normalizeLegacyArtifact({
				title: "note.md",
				content: "# Note",
				ref_kind: "inline",
				mime_type: "text/markdown",
				kind: "doc",
				source: "mcp",
			}),
		).toEqual({
			title: "note.md",
			path: undefined,
			kind: "doc",
			body: "# Note",
			content: "# Note",
			contentType: "text/markdown",
			mimeType: "text/markdown",
			refKind: "inline",
			refValue: "# Note",
			metadata: undefined,
			source: "mcp",
		});
	});

	it("returns text content payloads for inline resources", async () => {
		await expect(
			artifactContentPayload({
				body: "hello",
				contentType: "text/plain",
				metadata: { refKind: "inline" },
			}),
		).resolves.toEqual({
			content_type: "text/plain",
			size: 5,
			text: "hello",
		});
	});
});
