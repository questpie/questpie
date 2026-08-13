import type { QueryHandler } from "./generated-app";
import { operation } from "./framework";

export const importedInput = operation.object<{ companyId: string }>();

export const importedHandler = (async ({ input, ctx }) => {
	const company = await ctx.data.companies.get({
		key: { id: input.companyId },
	});

	// @ts-expect-error Imported handlers retain the exact generated context.
	ctx.data.accounts;
	return { found: company !== null };
}) satisfies QueryHandler<typeof importedInput>;
