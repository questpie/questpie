import type { AppCollections } from "./app-types";

export async function projectWorkspacePath(
	collections: AppCollections,
	projectId?: string | null,
) {
	if (!projectId) return undefined;
	const project = await collections.projects.findOne({
		where: { id: projectId },
	});
	const path = typeof project?.path === "string" ? project.path.trim() : "";
	return path || undefined;
}
