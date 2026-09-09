import { QueryClient } from "@tanstack/react-query";
import { createQueryAdapter } from "questpie/react-query";

import { createClient } from "#questpie/client";

export function createSupportDesk(
	context: Readonly<{ membershipId: string; organizationId: string }>,
) {
	return createClient({ baseUrl: location.origin }).withContext(context);
}

export type SupportDesk = ReturnType<typeof createSupportDesk>;

export function createSupportDeskOwner(
	context: Parameters<typeof createSupportDesk>[0],
) {
	const desk = createSupportDesk(context);
	const cache = new QueryClient();
	return { desk, cache, api: createQueryAdapter(desk, cache) };
}

export type SupportDeskAdapter = ReturnType<
	typeof createSupportDeskOwner
>["api"];

// The generated client does not yet export named operation result aliases.
// These intentionally awkward application-local aliases are DX evidence, not
// a parallel wire contract: every field remains inferred from #questpie/client.
export type TicketPage = Awaited<
	ReturnType<SupportDesk["queries"]["tickets.queue"]>
>;
export type TicketListNode = TicketPage["nodes"][number];
export type TicketDetail = NonNullable<
	Awaited<ReturnType<SupportDesk["queries"]["tickets.detail"]>>
>;
export type LabelPage = Awaited<
	ReturnType<SupportDesk["queries"]["labels.page"]>
>;
export type TeamPage = Awaited<
	ReturnType<SupportDesk["queries"]["teams.list"]>
>;
