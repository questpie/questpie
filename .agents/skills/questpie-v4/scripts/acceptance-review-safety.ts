import { lstatSync } from "node:fs";

export class AcceptanceReviewSafetyError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AcceptanceReviewSafetyError";
	}
}

export function requireCleanReviewTree(status: string): void {
	if (status !== "")
		throw new AcceptanceReviewSafetyError("review worktree is not clean");
}

export function requireAbsentReviewOutput(path: string): void {
	try {
		lstatSync(path);
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "ENOENT"
		)
			return;
		throw error;
	}
	throw new AcceptanceReviewSafetyError("review output already exists");
}

export function requireCommittedReviewBytes(
	workingBytes: string,
	committedBytes: string,
): void {
	if (workingBytes !== committedBytes)
		throw new AcceptanceReviewSafetyError("record differs from committed HEAD");
}
