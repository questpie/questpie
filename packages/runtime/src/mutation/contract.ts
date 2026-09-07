import { OperationFailure } from "../operation";

export {
	canonicalMutationBytes,
	deterministicUuid,
	mutationDigest,
} from "./canonical";

/** Private checkpoint failure; ordinary Operation normalization keeps its identity. */
export class MutationReceiptUnavailable extends OperationFailure {
	constructor() {
		super("INTERNAL");
	}
}
