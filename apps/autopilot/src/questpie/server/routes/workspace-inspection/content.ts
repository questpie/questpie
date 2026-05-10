import { route } from "questpie/services";
import { z } from "zod";

import { resolveRunProject } from "../../lib/run-project";
import { readWorkspace } from "../../lib/workspace-inspection";

const schema = z.object({
	runId: z.string(),
	path: z.string().min(1),
});

export default route()
	.post()
	.schema(schema)
	.handler(async ({ input, collections }) => {
		const { project } = await resolveRunProject(collections, input.runId);
		const file = await readWorkspace(String(project.path), input.path);
		return {
			runId: input.runId,
			path: file.path,
			content: file.content,
			contentType: file.contentType,
			encoding: file.encoding,
			isText: file.isText,
		};
	});
