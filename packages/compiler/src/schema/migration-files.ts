import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { CompilerDiagnosticError } from "../diagnostic";
import type {
	CommittedMigration,
	CommittedMigrationFilesV1,
	MigrationPlanV1,
	SchemaProjectionV1,
} from "../schema";
import { verifyCommittedMigration } from "../schema";

const fileNames = [
	"migration.json",
	"plan.json",
	"base-schema.json",
	"target-schema.json",
	"up.sql",
	"checksum.sha256",
] as const satisfies readonly (keyof CommittedMigrationFilesV1)[];

export async function loadCommittedMigration(
	directory: string,
): Promise<CommittedMigration> {
	let names: string[];
	try {
		names = (await readdir(directory)).sort();
	} catch {
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-024",
			"missingLocalMigration",
			`${basename(directory)} is not a readable committed migration`,
			{ directory },
		);
	}
	if (JSON.stringify(names) !== JSON.stringify([...fileNames].sort()))
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-023",
			"checksumMismatch",
			`${basename(directory)} does not contain the exact six-file contract`,
			{ directory, names },
		);

	let files: CommittedMigrationFilesV1;
	try {
		files = Object.fromEntries(
			await Promise.all(
				fileNames.map(async (name) => [
					name,
					await readFile(join(directory, name), "utf8"),
				]),
			),
		) as unknown as CommittedMigrationFilesV1;
	} catch {
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-024",
			"missingLocalMigration",
			`${basename(directory)} does not contain the exact six-file contract`,
			{ directory },
		);
	}

	let plan: MigrationPlanV1;
	let baseSchema: SchemaProjectionV1;
	let targetSchema: SchemaProjectionV1;
	try {
		plan = JSON.parse(files["plan.json"]) as MigrationPlanV1;
		baseSchema = JSON.parse(files["base-schema.json"]) as SchemaProjectionV1;
		targetSchema = JSON.parse(
			files["target-schema.json"],
		) as SchemaProjectionV1;
	} catch {
		throw new CompilerDiagnosticError(
			"QP-SCHEMA-023",
			"checksumMismatch",
			`${basename(directory)} contains invalid artifact JSON`,
			{ directory },
		);
	}

	const committed: CommittedMigration = {
		identity: basename(directory),
		checksum: files["checksum.sha256"].trimEnd(),
		plan,
		baseSchema,
		targetSchema,
		files,
	};
	verifyCommittedMigration(committed);
	return committed;
}
