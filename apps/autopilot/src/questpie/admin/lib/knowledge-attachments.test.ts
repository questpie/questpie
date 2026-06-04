import { describe, expect, it } from "vitest";

import {
	createKnowledgeChatAttachment,
	knowledgeMetadataEntries,
	knowledgeSummary,
} from "./knowledge-attachments";

describe("knowledge attachment helpers", () => {
	it("creates concise structured chat attachments", () => {
		const attachment = createKnowledgeChatAttachment({
			id: "knowledge-1",
			title: "Runtime notes",
			path: "projects/autopilot/runtime-notes.md",
			kind: "summary",
			contentType: "text/markdown",
			renderer: "markdown",
			source: "worker",
			sourceRef: "run:abc",
			scopeType: "project",
			project: { id: "project-1", title: "Autopilot" },
			task: "task-1",
			run: { id: "run-1" },
			body: "# Runtime notes\n\nWorkers should stream markdown.",
			metadata: {
				summary: "Worker markdown streaming summary.",
				seed: "internal-demo-fixture",
				internal: { raw: true },
			},
		});

		expect(attachment).toEqual({
			type: "ref",
			source: "knowledge-detail",
			label: "Runtime notes",
			refType: "knowledge",
			refId: "knowledge-1",
			content: "# Runtime notes\n\nWorkers should stream markdown.",
			metadata: {
				summary: "Worker markdown streaming summary.",
				path: "projects/autopilot/runtime-notes.md",
				kind: "summary",
				contentType: "text/markdown",
				renderer: "markdown",
				sourceRef: "run:abc",
				scopeType: "project",
				projectId: "project-1",
				taskId: "task-1",
				runId: "run-1",
			},
		});
	});

	it("renders only useful metadata entries", () => {
		expect(
			knowledgeMetadataEntries({
				summary: "Useful",
				runtime: "codex",
				seed: "fixture",
				rawPayload: { hidden: true },
			}),
		).toEqual([
			["summary", "Useful"],
			["runtime", "codex"],
		]);
	});

	it("derives a readable summary from markdown body", () => {
		expect(
			knowledgeSummary({
				id: "knowledge-2",
				body: "# Result\n\n- Finished **cleanly**.\n- Verified typecheck.",
			}),
		).toBe("Result - Finished **cleanly**. - Verified typecheck.");
	});
});
