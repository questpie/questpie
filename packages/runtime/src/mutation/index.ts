import type { PreparedOperation } from "../operation";

export {
	createCollectionOperationAdapterExecutor,
	executeCollectionOperationAdapter,
	linkCollectionOperationAdapters,
} from "./adapter";
export type {
	CollectionOperationAdapterFacts,
	LinkedCollectionOperationAdaptersV1,
	LinkedCollectionOperationAdapterV1,
} from "./adapter";
export {
	CommittedResultUnavailable,
	type CommittedResultUnavailablePayload,
} from "../operation";
export { createPostgresCollectionMutationData } from "./collection";
export { linkJobProjection, linkReactionProjection } from "../durable";
export type { LinkedReactionProjection } from "../durable";
export { createPostgresDatabaseMutationInvoker } from "./postgres-database";
export { createPostgresJobAcceptanceTransaction } from "./postgres-job-acceptance";
export { linkCollectionMutationPrograms } from "./program";
export { linkPostgresCollectionOperationPlans } from "./postgres-program";
export { linkPostgresMutationTransactionStatements } from "./postgres-transaction-statements";
export type {
	LinkedPostgresMutationTransactionStatement,
	LinkedPostgresMutationTransactionStatements,
} from "./postgres-transaction-statements";
export type {
	CollectionOperationProgramV1,
	FieldNormalizerProgramV1,
	LinkedCollectionMutationProgramsV1,
	LinkedCollectionOperationProgramV1,
	MutationPolicyLinkV1,
	ServerValueProgramV1,
} from "./program";
export type {
	LinkedPostgresCollectionOperationPlanV1,
	LinkedPostgresCollectionOperationPlansV1,
	LinkedPostgresCreateOperationPlanV1,
	LinkedPostgresGetOperationPlanV1,
} from "./postgres-program";

export type MutationCallOptions = Readonly<{
	signal?: AbortSignal;
	deadline?: number;
}>;

export type MutationInvocationResult = Readonly<{
	committed: true;
	value: unknown;
}>;

export type MutationInvoker<View> = (
	operation: PreparedOperation<View>,
	callId: string,
	options?: MutationCallOptions,
) => Promise<MutationInvocationResult>;
