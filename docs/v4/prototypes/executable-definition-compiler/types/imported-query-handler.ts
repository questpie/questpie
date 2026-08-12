import { operation } from "questpie";

import type { QueryHandler } from "#questpie/app";

export const importedInput = operation.object({
	companyId: operation.uuid(),
});

export const importedHandler = (async ({ input, ctx }) => {
	const company = await ctx.data.companies.get({
		key: { id: input.companyId },
		select: { id: true, name: true },
	});

	// @ts-expect-error Imported handlers keep the exact generated context.
	ctx.data.accounts;
	return { found: company !== null };
}) satisfies QueryHandler<typeof importedInput>;
