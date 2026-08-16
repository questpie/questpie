import type { PreparedOperation } from "../operation";

export { linkCollectionMutationPrograms } from "./program";
export type {
	CollectionOperationProgramV1,
	FieldNormalizerProgramV1,
	LinkedCollectionMutationProgramsV1,
	LinkedCollectionOperationProgramV1,
	MutationPolicyLinkV1,
	ServerValueProgramV1,
} from "./program";

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
