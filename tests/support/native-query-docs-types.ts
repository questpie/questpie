// Copied into the installed tutorial consumer; every type comes from its generated contract.
import { useMutation, useQuery } from "@tanstack/react-query";

import type { SupportAdapter } from "./web/support-screen";

export function useNativeTutorialTypeChecks(api: SupportAdapter, id: string) {
	const detail = useQuery(
		api.queries["tickets.detailPage"].options({
			ids: [id],
			first: 1,
			after: null,
		}),
	);
	const page = detail.data!;
	page.nodes[0]?.comments[0]?.createdAt.toISOString();
	// @ts-expect-error A decoded timestamp is not a wire string.
	const timestamp: string = page.nodes[0]!.comments[0]!.createdAt;
	// @ts-expect-error This Field was not selected by the authored Query.
	void page.nodes[0]!.privateNote;
	api.queries["tickets.detailPage"].options({
		ids: [id],
		// @ts-expect-error The Query input comes from the generated parameter codecs.
		first: "one",
		after: null,
	});
	const operation = api.mutations["tickets.rename"];
	const mutation = useMutation({
		...operation.options(),
		onMutate: (input) => ({ requestedSummary: input.summary }),
		onError: (error, _input, intent) => {
			intent?.requestedSummary.toUpperCase();
			// @ts-expect-error Pending intent preserves its inferred string.
			intent?.requestedSummary.toFixed();
			if (operation.isError(error)) {
				const code: "TICKET_UNAVAILABLE" = error.code;
				void code;
			}
			// @ts-expect-error Unknown transport failures are not declared business failures.
			void error.code;
		},
	});
	mutation.mutate({ id, summary: "Changed summary" });
	// @ts-expect-error Collection-derived input requires a summary.
	mutation.mutate({ id });
	// @ts-expect-error Collection-derived summary is text.
	mutation.mutate({ id, summary: 42 });
	void timestamp;
}
