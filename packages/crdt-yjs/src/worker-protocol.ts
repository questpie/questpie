import type { CrdtEngineLimits, CrdtEngineReplica } from "questpie/crdt";

export type YjsWorkerOperation = Readonly<{
	id: number;
	method: "stage";
	input: {
		replica: CrdtEngineReplica<"text", string>;
		update: Uint8Array;
		limits?: Partial<CrdtEngineLimits>;
	};
}>;

export type YjsWorkerResponse =
	| Readonly<{ type: "ready" }>
	| Readonly<{ type: "result"; id: number; ok: true; value: unknown }>
	| Readonly<{ type: "result"; id: number; ok: false; message: string }>;
