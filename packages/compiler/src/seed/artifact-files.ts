import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { CompilerDiagnosticError } from "../diagnostic";
import type { CommittedSeedV1, SeedStepV1 } from "./committed-seed";
import { verifyCommittedSeed } from "./committed-seed";

const fileNames = [
	"seed.json",
	"steps.json",
	"checksum.sha256",
] as const satisfies readonly (keyof CommittedSeedV1["files"])[];

function invalid(directory: string, message: string): never {
	throw new CompilerDiagnosticError(
		"QP-SEED-004",
		"checksumMismatch",
		`${basename(directory)} ${message}`,
		{ directory },
	);
}

export async function loadCommittedSeed(
	directory: string,
): Promise<CommittedSeedV1> {
	let names: string[];
	try {
		names = (await readdir(directory)).sort();
	} catch {
		return invalid(directory, "is not a readable committed Seed");
	}
	if (JSON.stringify(names) !== JSON.stringify([...fileNames].sort()))
		return invalid(directory, "does not contain the exact three-file contract");

	let files: CommittedSeedV1["files"];
	try {
		files = Object.fromEntries(
			await Promise.all(
				fileNames.map(async (name) => [
					name,
					await readFile(join(directory, name), "utf8"),
				]),
			),
		) as unknown as CommittedSeedV1["files"];
	} catch {
		return invalid(directory, "does not contain readable artifact bytes");
	}

	let metadata: Readonly<Record<string, unknown>>;
	let steps: readonly SeedStepV1[];
	try {
		metadata = JSON.parse(files["seed.json"]);
		steps = JSON.parse(files["steps.json"]);
	} catch {
		return invalid(directory, "contains invalid artifact JSON");
	}
	const identity = `seed:${basename(directory)}` as const;
	const committed: CommittedSeedV1 = {
		identity,
		checksum: files["checksum.sha256"].trimEnd(),
		dependencies: (metadata.dependencies ?? []) as readonly `seed:${string}`[],
		steps,
		files,
	};
	verifyCommittedSeed(committed);
	return committed;
}
