import { route } from "questpie/services";
import { z } from "zod";

import { sessionOnly } from "../../lib/route-access";
import { resolveRunProject } from "../../lib/run-project";
import {
	diffWorkspace,
	normalizeWorkspacePath,
} from "../../lib/workspace-inspection";

const schema = z.object({
	runId: z.string(),
	path: z.string().optional(),
	includeDirty: z.boolean().default(true),
});

export default route()
	.post()
	.access(sessionOnly)
	.schema(schema)
	.handler(async (ctx) => {
		const { input, collections, services } = ctx;
		const { project } = await resolveRunProject(collections, input.runId);
		const path = normalizeWorkspacePath(input.path);
		const result = await diffWorkspace(
			String(project.path),
			path,
			input.includeDirty,
		);
		const git = services.gitProviderAdapters.buildDiffContext({
			remoteUrl: String(project.gitRemote ?? ""),
			defaultBranch: String(project.defaultBranch ?? "main"),
			base: result.base,
			head: result.head,
		});

		return { runId: input.runId, path, ...result, git };
	});
