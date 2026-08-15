import type { PreparedOperation } from "../operation";

export type MutationCallOptions = Readonly<{
	signal?: AbortSignal;
	deadline?: number;
}>;

export type MutationInvoker<View> = (
	operation: PreparedOperation<View>,
	callId: string,
	options?: MutationCallOptions,
) => Promise<unknown>;
