import { ApiError } from "questpie/errors";

export async function resolveRunProject(
	collections: Questpie.AppContext["collections"],
	runId: string,
) {
	const run = await collections.runs.findOne({
		where: { id: runId },
		with: { project: true },
	});
	if (!run) throw ApiError.notFound("Run", runId);
	const projectId =
		typeof run.project === "string"
			? run.project
			: run.project && typeof run.project === "object" && "id" in run.project
				? String(run.project.id)
				: null;
	const project =
		run.project && typeof run.project === "object"
			? run.project
			: projectId
				? await collections.projects.findOne({ where: { id: projectId } })
				: null;
	if (!project)
		throw ApiError.badRequest(`Run ${runId} is not linked to a project`);
	if (!project.path) {
		throw ApiError.badRequest(
			`Project ${project.id} does not have a local path`,
		);
	}
	return { run, project };
}
