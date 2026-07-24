import type { CrdtEngineLimits, CrdtEngineReplica } from "questpie/crdt";

export type YjsWorkerOperation = Readonly<{
	method: "stage";
	input: {
		replica: CrdtEngineReplica<"text", string>;
		update: Uint8Array;
		limits?: Partial<CrdtEngineLimits>;
	};
}>;

export type YjsWorkerResponse =
	| Readonly<{ ok: true; value: unknown }>
	| Readonly<{ ok: false; message: string }>;
