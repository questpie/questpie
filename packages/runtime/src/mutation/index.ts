import type { PreparedOperation } from "../operation";

export type MutationInvoker<View> = (
	operation: PreparedOperation<View>,
	callId: string,
) => Promise<unknown>;
