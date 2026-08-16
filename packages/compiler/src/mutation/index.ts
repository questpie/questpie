import { compareAscii } from "../canonical";
import type { NormalizedResource } from "../types";

export { mutationDiscoverySource } from "./discovery";
export { projectCollectionOperationSets } from "./operation-set";
export type {
	CollectionOperationProgramsV1,
	CollectionOperationProgramV1,
} from "./operation-set-contract";
export {
	projectMutationGeneratedContract,
	renderGeneratedMutationData,
} from "./generated-contract";
export type { MutationGeneratedContractV1 } from "./generated-contract";
export { lowerPostgresCollectionOperationPlans } from "./postgres";
export type {
	PostgresCollectionOperationPlansV1,
	PostgresCreateOperationPlanV1,
	PostgresGetOperationPlanV1,
} from "./postgres-contract";

export {
	renderMutationDeclarations,
	renderMutationFactory,
} from "./declarations";

export function projectMutations(resources: readonly NormalizedResource[]) {
	const mutations = resources
		.filter((resource) => resource.kind === "mutation")
		.sort((left, right) => compareAscii(left.identity, right.identity));
	return Object.freeze({
		projection: Object.freeze({
			format: "questpie.mutation-projection" as const,
			version: 1 as const,
			mutations: Object.freeze(
				mutations.map((resource) => {
					const declaredErrors = resource.contract.declaredErrors as Readonly<
						Record<
							string,
							Readonly<{
								code: string;
								status: number;
								payload: unknown;
							}>
						>
					>;
					return Object.freeze({
						identity: resource.identity,
						kind: "mutation" as const,
						mode: "writeTransaction" as const,
						input: resource.contract.input,
						output: resource.contract.output,
						errors: Object.freeze(
							Object.entries(declaredErrors)
								.sort(([left], [right]) => compareAscii(left, right))
								.map(([key, error]) => Object.freeze({ key, ...error })),
						),
						policy: resource.contract.policy,
						exposure: Object.freeze({
							direct: true as const,
							network: resource.contract.exposure === "network",
						}),
						limits: Object.freeze({
							inputBytes: 1_048_576 as const,
							resultBytes: 1_048_576 as const,
							rowsWritten: 100 as const,
							durationMilliseconds: 5_000 as const,
						}),
						executableSlot: "handler" as const,
						origin: resource.origin,
					});
				}),
			),
		}),
		transactions: Object.freeze({
			format: "questpie.mutation-transaction-projection" as const,
			version: 1 as const,
			plans: Object.freeze(
				mutations.map((resource) =>
					Object.freeze({
						owner: resource.identity,
						isolation: "readCommitted" as const,
						rootTransactions: 1 as const,
						nestedCollectionCalls: "joinOwner" as const,
						savepoints: "notAvailable" as const,
						operationTime: "transactionStable" as const,
						callIdentity: Object.freeze({
							scope: Object.freeze([
								"application",
								"tenant",
								"operation",
								"principal",
								"callId",
							] as const),
							inputDigestBound: true as const,
						}),
						receipt: Object.freeze({
							writtenInOwnerTransaction: true as const,
							stores: Object.freeze([
								"transactionId",
								"resultBytes",
								"outcome",
								"committedAt",
							] as const),
						}),
						dispatch: Object.freeze({
							status: "intentOnly" as const,
							writtenInOwnerTransaction: true as const,
						}),
						limits: Object.freeze({
							inputBytes: 1_048_576 as const,
							resultBytes: 1_048_576 as const,
							rowsWritten: 100 as const,
							durationMilliseconds: 5_000 as const,
						}),
					}),
				),
			),
		}),
	});
}
