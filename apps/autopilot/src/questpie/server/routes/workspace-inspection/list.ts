import { route } from "questpie/services";
import { z } from "zod";

import { sessionOnly } from "../../lib/route-access";
import { resolveRunProject } from "../../lib/run-project";
import {
	listWorkspace,
	normalizeWorkspacePath,
} from "../../lib/workspace-inspection";

const schema = z.object({
	runId: z.string(),
	path: z.string().optional(),
});

export default route()
	.post()
	.access(sessionOnly)
	.schema(schema)
	.handler(async ({ input, collections }) => {
		const { project } = await resolveRunProject(collections, input.runId);
		const path = normalizeWorkspacePath(input.path);
		const entries = await listWorkspace(String(project.path), path);
		return { runId: input.runId, path, entries };
	});
