import { codec, context, defineContext } from "questpie";

import { institutions } from "./institutions";

export const archiveContext = defineContext({
	name: "app.context",
	input: codec.object({ archiveCode: codec.text() }),
	resolve: async ({ input, principal, bootstrap }) => {
		if (principal.kind === "anonymous") throw context.error.unauthenticated();
		const institution = await bootstrap.get(institutions, {
			key: { code: input.archiveCode },
			select: { code: true, tenantId: true },
		});
		if (institution === null) throw context.error.notFound("institution");
		return {
			tenant: context.tenant({ id: institution.tenantId }),
			values: { selectedArchiveCode: institution.code },
		};
	},
});
