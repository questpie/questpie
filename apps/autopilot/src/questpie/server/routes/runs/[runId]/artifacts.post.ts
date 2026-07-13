import { route } from "questpie/services";

import {
	artifactsAccess,
	handleCreateArtifact,
	type ArtifactsContext,
} from "./_artifacts";

export default route()
	.post()
	.access(artifactsAccess)
	.params<{ runId: string }>()
	.raw()
	.handler(async (ctx) => handleCreateArtifact(ctx as ArtifactsContext));
