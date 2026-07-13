import { route } from "questpie/services";

import {
	artifactsAccess,
	handleListArtifacts,
	type ArtifactsContext,
} from "./_artifacts";

export default route()
	.get()
	.access(artifactsAccess)
	.params<{ runId: string }>()
	.raw()
	.handler(async (ctx) => handleListArtifacts(ctx as ArtifactsContext));
