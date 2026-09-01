import { codec, type CodecValue } from "../../../../packages/questpie/src";
import type { OperationDescription } from "./contract";

const closeInput = codec.object({ id: codec.uuid() });
const closeOutput = codec.object({ id: codec.uuid(), status: codec.text() });

type CloseInput = CodecValue<typeof closeInput>;
type CloseOutput = CodecValue<typeof closeOutput>;

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
			output: { id: "synthetic-ticket-id", status: 42 },
		},
	],
} as const satisfies OperationDescription<CloseInput, CloseOutput>;
