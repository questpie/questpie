import { OperationFailure } from "../operation";

/** Private checkpoint failure; ordinary Operation normalization keeps its identity. */
export class MutationReceiptUnavailable extends OperationFailure {
	constructor() {
		super("INTERNAL");
	}
}
