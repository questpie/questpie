import type { DataQueryTemplateV1 } from "../relational";

export type CollectionOperationMember =
	| "create"
	| "delete"
	| "get"
	| "list"
	| "update";

export interface CollectionOperationProgramV1 {
	readonly identity: `query:${string}` | `mutation:${string}`;
	readonly kind: "query" | "mutation";
	readonly mode: "readSnapshot" | "writeTransaction";
	readonly target: `collection:${string}`;
	readonly member: CollectionOperationMember;
	readonly policy: `policy:${string}`;
	readonly keyFields: readonly (readonly string[])[];
	readonly callerInputFields: readonly (readonly string[])[];
	readonly selectedFieldPaths: readonly (readonly string[])[];
	readonly dataQuery: DataQueryTemplateV1 | null;
	readonly dataQueryDigest: string | null;
	readonly normalizerProgramDigest: string | null;
	readonly serverValueProgramDigest: string | null;
	readonly outputCardinality: "many" | "one" | "optionalOne";
	readonly limits:
		| Readonly<{
				inputBytes: number;
				resultBytes: number;
				rowsRead: number;
				durationMilliseconds: number;
		  }>
		| Readonly<{
				inputBytes: number;
				resultBytes: number;
				rowsWritten: number;
				durationMilliseconds: number;
		  }>;
}

export interface CollectionOperationProgramsV1 {
	readonly format: "questpie.collection-operation-programs";
	readonly version: 1;
	readonly operations: readonly CollectionOperationProgramV1[];
}
