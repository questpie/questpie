import { ApiError } from "questpie/errors";

import type { AppCollections } from "./app-types";
import { relationId } from "./records";

export async function resolveRunProject(
	collections: AppCollections,
	runId: string,
) {
	const run = await collections.run_links.findOne({
		where: { id: runId },
	});
	if (!run) throw ApiError.notFound("Run", runId);

	const projectId = relationId(run.project);
	if (!projectId) {
		throw ApiError.badRequest(`Run ${runId} is not linked to a project`);
	}

	const project = await collections.projects.findOne({
		where: { id: projectId },
	});
	if (!project) {
		throw ApiError.notFound("Project", projectId);
	}
	if (!project.path) {
		throw ApiError.badRequest(
			`Project ${project.id} does not have a local path`,
		);
	}

	return { run, project };
}
