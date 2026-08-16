import type { PreparedOperation } from "../operation";

export { CommittedResultUnavailable } from "./committed-result-unavailable";
export type { CommittedResultUnavailablePayload } from "./committed-result-unavailable";
export { createPostgresCollectionMutationData } from "./collection";
export { linkCollectionMutationPrograms } from "./program";
export { linkPostgresCollectionOperationPlans } from "./postgres-program";
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
