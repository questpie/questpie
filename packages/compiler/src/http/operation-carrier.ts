type JsonRecord = Readonly<Record<string, unknown>>;
type JsonSchema = Readonly<Record<string, unknown>>;

function headerParameter(
	name: string,
	required: boolean,
	schema: JsonSchema = { type: "string" },
	description?: string,
): JsonRecord {
	return {
		name,
		in: "header",
		required,
		...(description === undefined ? {} : { description }),
		schema,
	};
}

export function projectOperationCarrierHeaders(
	input: Readonly<{
		kind: "action" | "mutation" | "query";
		contextSchema: JsonSchema;
		contextAcceptsEmpty: boolean;
		compatibility: Readonly<{
			application: string;
			clientContractDigest: string;
			wireDigest: string;
		}>;
	}>,
): JsonRecord[] {
	return [
		...(input.kind === "query"
			? [
					headerParameter(
						"Questpie-Context",
						!input.contextAcceptsEmpty,
						{
							type: "string",
							...(input.contextAcceptsEmpty ? { default: "e30" } : {}),
							pattern: "^[A-Za-z0-9_-]+$",
							maxLength: 87_382,
							"x-questpie-decoded-schema": input.contextSchema,
							"x-questpie-http-encoding": "canonical-json-base64url",
						},
						"Generated clients encode this header. It is unpadded base64url over canonical Context JSON; the default is present only when the Context codec accepts {}.",
					),
				]
			: input.kind === "mutation"
				? [
						headerParameter(
							"Idempotency-Key",
							true,
							undefined,
							"Stable caller identity for safe Mutation receipt replay. Reusing it with different canonical input fails with IDEMPOTENCY_CONFLICT.",
						),
					]
				: [
						headerParameter(
							"Effect-Key",
							true,
							undefined,
							"Stable caller identity for an external Action effect and its explicit outcome ambiguity.",
						),
					]),
		...(input.kind === "mutation"
			? []
			: [
					headerParameter(
						"Questpie-Call-Id",
						false,
						undefined,
						"Optional caller correlation identity; generated clients create one when omitted.",
					),
				]),
		headerParameter(
			"Questpie-Application",
			false,
			{
				type: "string",
				const: input.compatibility.application,
				default: input.compatibility.application,
			},
			"Generated application compatibility identity.",
		),
		headerParameter(
			"Questpie-Client-Contract",
			false,
			{
				type: "string",
				const: input.compatibility.clientContractDigest,
				default: input.compatibility.clientContractDigest,
			},
			"Generated client compatibility identity.",
		),
		headerParameter(
			"Questpie-Timeout-Milliseconds",
			false,
			{ type: "integer", minimum: 1 },
			"Optional positive end-to-end operation deadline in milliseconds.",
		),
		headerParameter(
			"Questpie-Wire-Digest",
			false,
			{
				type: "string",
				const: input.compatibility.wireDigest,
				default: input.compatibility.wireDigest,
			},
			"Canonical HTTP wire compatibility identity.",
		),
	].sort((left, right) => compareAscii(String(left.name), String(right.name)));
}
import { compareAscii } from "../canonical";
