import type { OperationDescription } from "./contract";

type CloseInput = Readonly<{ id: string }>;
type CloseOutput = Readonly<{ id: string; status: "closed" }>;

export const describedClose = {
	summary: "Close an open ticket",
	description: "Returns the committed ticket state.",
	examples: [
		{
			input: { id: "synthetic-ticket-id" },
			output: { id: "synthetic-ticket-id", status: "closed" },
		},
	],
} as const satisfies OperationDescription<CloseInput, CloseOutput>;

export const invalidInput = {
	summary: "Close an open ticket",
	examples: [
		{
			// @ts-expect-error Operation examples inherit the input codec value.
			input: { ticketId: "synthetic-ticket-id" },
		},
	],
} as const satisfies OperationDescription<CloseInput, CloseOutput>;

export const invalidOutput = {
	summary: "Close an open ticket",
	examples: [
		{
			input: { id: "synthetic-ticket-id" },
			// @ts-expect-error Operation examples inherit the output codec value.
			output: { id: "synthetic-ticket-id", status: "open" },
		},
	],
} as const satisfies OperationDescription<CloseInput, CloseOutput>;
