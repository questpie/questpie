import type { Principal } from "questpie";

import { decodeRuntimeCodec } from "../codec";
import {
	createLiveQueryObservation,
	linkLiveQueryProgram,
	type LiveQueryObservation,
} from "../live-query";
import { OperationFailure } from "../operation";
import type { RuntimeArtifactsV1 } from "./artifacts";
import {
	createRealtimeCarrier,
	decodeRealtimeWireContract,
	type LiveQueryCoordinator,
	type RealtimeCarrierObservedPlan,
} from "./realtime";

type MaybePromise<Value> = Value | Promise<Value>;

type RuntimeRealtimeExtension = Readonly<{
	fetch(request: Request): Promise<Response | null>;
	beginDrain(): void;
	drain(input: Readonly<{ deadlineAt: number }>): Promise<void>;
}>;

export type RuntimeRealtimeFactory<Input> = (
	input: Readonly<{
		artifacts: RuntimeArtifactsV1;
		artifactFiles: Readonly<Record<string, Uint8Array | string>>;
		contextInput: unknown;
		resolvePrincipal(request: Request): MaybePromise<Principal | null>;
		evaluate(
			scope: Readonly<{
				principal: Principal;
				context: Input;
				query: string;
				input: unknown;
				signal: AbortSignal;
				observation: LiveQueryObservation;
			}>,
		): Promise<unknown>;
		onObservedPlan?: (input: RealtimeCarrierObservedPlan) => MaybePromise<void>;
		coordinator?: LiveQueryCoordinator;
	}>,
) => RuntimeRealtimeExtension | null;

export const createRuntimeRealtime: RuntimeRealtimeFactory<unknown> = (
	input,
) => {
	if (input.artifacts.runtimeBuild.realtimeWireDigest === null) return null;
	if (!input.coordinator?.durable)
		throw new TypeError("realtime requires durable PostgreSQL coordination");
	const contractBytes = input.artifactFiles["realtime-wire-contract.json"];
	if (contractBytes === undefined)
		throw new TypeError("missing realtime-wire-contract.json");
	const contract = decodeRealtimeWireContract(
		JSON.parse(
			typeof contractBytes === "string"
				? contractBytes
				: new TextDecoder("utf-8", { fatal: true }).decode(contractBytes),
		),
	);
	if (
		contract.application !== input.artifacts.runtimeBuild.application ||
		contract.clientContractDigest !==
			input.artifacts.runtimeBuild.clientContractDigest ||
		contract.operationWireDigest !== input.artifacts.wireContract.digest ||
		contract.digest !== input.artifacts.runtimeBuild.realtimeWireDigest
	)
		throw new TypeError("realtime wire binding does not match");
	const read = (path: string): unknown => {
		const bytes = input.artifactFiles[path];
		if (bytes === undefined) throw new TypeError(`missing ${path}`);
		return JSON.parse(
			typeof bytes === "string"
				? bytes
				: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
		);
	};
	const program = linkLiveQueryProgram({
		watchability: read("query-watchability.json"),
		dependencyAlgebra: read("live-query-dependency-algebra.json"),
		changeLedger: read("change-ledger.json"),
		reconciliation: read("change-reconciliation.json"),
		resume: read("live-query-resume.json"),
		captureBoundary: read("change-capture-boundary.json"),
		limits: read("live-query-limits.json"),
	});
	return createRealtimeCarrier({
		contract,
		resolvePrincipal: input.resolvePrincipal,
		decodeContext: (value: unknown) =>
			decodeRuntimeCodec(input.contextInput as never, value, "$context"),
		evaluate: async ({ principal, context, query, input: value, signal }) => {
			const linked = program.queries.get(query);
			if (!linked?.watchable) throw new OperationFailure("NOT_FOUND");
			const observation = createLiveQueryObservation(linked);
			const result = await input.evaluate({
				principal,
				context,
				query,
				input: value,
				signal,
				observation,
			});
			return Object.freeze({ result, observedPlan: observation.finish() });
		},
		onObservedPlan: input.onObservedPlan,
		durableCoordinator: input.coordinator.durable,
	});
};
