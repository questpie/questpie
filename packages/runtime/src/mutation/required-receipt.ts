import { isPostgresTransactionId, OperationFailure } from "../operation";
import { mutationDigest } from "./canonical";

const requiredReceipt = Symbol("requiredMutationReceipt");
type ReceiptExpectation = Readonly<{
	transactionId: string;
	resultDigest: string;
}>;

/** Private checkpoint failure; ordinary Operation normalization keeps its identity. */
export class MutationReceiptUnavailable extends OperationFailure {
	constructor() {
		super("INTERNAL");
	}
}

/** Preserve this private expectation across generated call-option spreads. */
export function withRequiredMutationReceipt<Options extends object>(
	options: Options,
	expectation: ReceiptExpectation,
): Options {
	if (
		!isPostgresTransactionId(expectation.transactionId) ||
		!/^[a-f0-9]{64}$/u.test(expectation.resultDigest)
	)
		throw new MutationReceiptUnavailable();
	return Object.freeze({
		...options,
		[requiredReceipt]: Object.freeze({
			transactionId: expectation.transactionId,
			resultDigest: expectation.resultDigest,
		}),
	});
}

export function requiredMutationReceipt(
	options: object | undefined,
): ReceiptExpectation | undefined {
	return (options as { [requiredReceipt]?: ReceiptExpectation } | undefined)?.[
		requiredReceipt
	];
}

export function assertRequiredMutationReceipt(
	expectation: ReceiptExpectation,
	receipt: Readonly<Record<string, unknown>>,
): void {
	if (
		receipt.transactionId !== expectation.transactionId ||
		!(receipt.resultBytes instanceof Uint8Array) ||
		mutationDigest(receipt.resultBytes) !== expectation.resultDigest
	)
		throw new MutationReceiptUnavailable();
}
