import { canonicalBytes } from "../canonical";
import { verifyCommittedMigration } from "./committed-migration";
import type { CommittedMigration } from "./contracts";
import type { ApplyMigrationsResult } from "./postgres-types";

type JsonRecord = Readonly<Record<string, unknown>>;

export interface CliExplanationV1 {
	readonly format: "questpie.cli-explanation";
	readonly version: 1;
	readonly command: string;
	readonly status: string;
	readonly facts: JsonRecord;
	readonly human: readonly string[];
}

function explanation(
	command: string,
	status: string,
	facts: JsonRecord,
	human: readonly string[],
): CliExplanationV1 {
	return {
		format: "questpie.cli-explanation",
		version: 1,
		command,
		status,
		facts,
		human,
	};
}

function fileBytes(files: object): Readonly<Record<string, number>> {
	return Object.fromEntries(
		Object.entries(files as Readonly<Record<string, string>>)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([name, value]) => [name, Buffer.byteLength(value)]),
	);
}

export function explainCommittedMigration(
	migration: CommittedMigration,
): CliExplanationV1 {
	verifyCommittedMigration(migration);
	const files = fileBytes(migration.files);
	const metadata = JSON.parse(migration.files["migration.json"]) as {
		planDigest: string;
	};
	const totalBytes = Object.values(files).reduce(
		(total, value) => total + Number(value),
		0,
	);
	const steps = migration.plan.steps.map((step) => ({
		kind: step.kind,
		targetIdentity: step.targetIdentity,
		classification: step.classification,
		lock: step.lock,
		scansData: step.scansData,
		rewritesTable: step.rewritesTable,
	}));
	return explanation(
		"migration create",
		"committed",
		{
			identity: migration.identity,
			checksum: migration.checksum,
			classification: migration.plan.classification,
			planDigest: metadata.planDigest,
			targetSchemaDigest: migration.plan.targetSchemaDigest,
			files,
			totalBytes,
			steps,
		},
		[
			`migration ${migration.identity}`,
			`status committed (${migration.plan.classification})`,
			`checksum ${migration.checksum}`,
			`target ${migration.plan.targetSchemaDigest}`,
			`files ${Object.keys(files).length} (${totalBytes} bytes)`,
			...steps.map(
				(step, index) =>
					`step ${String(index + 1).padStart(2, "0")} ${step.classification} ${step.kind} ${step.targetIdentity} lock=${step.lock} scan=${step.scansData} rewrite=${step.rewritesTable}`,
			),
		],
	);
}

export function explainMigrationApply(
	result: ApplyMigrationsResult,
): CliExplanationV1 {
	return explanation(
		"migration apply",
		result.status,
		{
			status: result.status,
			applied: result.applied,
			head: result.head,
			fingerprintDigest: result.fingerprintDigest,
		},
		[
			`migration apply ${result.status}`,
			`head ${result.head}`,
			`applied ${result.applied.length === 0 ? "none" : result.applied.join(", ")}`,
			`fingerprint ${result.fingerprintDigest}`,
		],
	);
}

export function renderCliExplanation(
	value: CliExplanationV1,
	format: "human" | "json",
): string {
	if (format === "human") return `${value.human.join("\n")}\n`;
	return canonicalBytes({
		format: value.format,
		version: value.version,
		command: value.command,
		status: value.status,
		facts: value.facts,
	});
}
