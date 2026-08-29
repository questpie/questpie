import {
	collectionLifecycleIssueIdentity,
	isCollectionLifecycleIssue,
} from "../mutation";
import {
	mapCollectionIssueToDeclaredError,
	normalizeOperationError,
	type PreparedOperation,
} from "../operation";

export function isOperationAbort(error: unknown): boolean {
	return error instanceof DOMException && error.name === "AbortError";
}

export function normalizeExecutedOperationError<View>(
	operation: PreparedOperation<View>,
	error: unknown,
) {
	if (!isCollectionLifecycleIssue(error)) return normalizeOperationError(error);
	try {
		return normalizeOperationError(
			mapCollectionIssueToDeclaredError(
				operation,
				collectionLifecycleIssueIdentity(error)!,
			),
		);
	} catch (mappingError) {
		return normalizeOperationError(mappingError);
	}
}
