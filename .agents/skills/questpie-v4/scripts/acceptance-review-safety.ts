import { lstatSync, realpathSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

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

export function requireAbsentReviewOutput(
	path: string,
	repositoryRoot: string,
): void {
	const root = realpathSync(resolve(repositoryRoot));
	const absolutePath = resolve(path);
	const fromRoot = relative(root, absolutePath);
	if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`))
		throw new AcceptanceReviewSafetyError("review output escapes repository");
	let current = root;
	for (const component of relative(root, dirname(absolutePath)).split(sep)) {
		if (component === "" || component === ".") continue;
		current = resolve(current, component);
		try {
			const stat = lstatSync(current);
			if (stat.isSymbolicLink() || !stat.isDirectory())
				throw new AcceptanceReviewSafetyError(
					"review output parent is not a real directory",
				);
		} catch (error) {
			if (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				error.code === "ENOENT"
			)
				break;
			throw error;
		}
	}
	try {
		lstatSync(absolutePath);
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
