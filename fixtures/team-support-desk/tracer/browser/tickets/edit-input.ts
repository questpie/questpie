import type { SupportSession } from "../auth/client";
import type { SupportDesk } from "../questpie";

type TicketEditInput = Parameters<SupportDesk["mutations"]["ticket.edit"]>[0];

export function ticketEditInput(
	role: SupportSession["role"],
	data: FormData,
	ticketId: string,
): TicketEditInput {
	const shared = {
		description: String(data.get("description")),
		summary: String(data.get("summary")),
		ticketId,
	};
	return role === "customer"
		? shared
		: { ...shared, priority: String(data.get("priority")) };
}
