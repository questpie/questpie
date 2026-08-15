import type { CliExplanationV1 } from "../schema";
import type { CommittedSeedV1 } from "./committed-seed";
import { verifyCommittedSeed } from "./committed-seed";

function fileBytes(files: object): Readonly<Record<string, number>> {
	return Object.fromEntries(
		Object.entries(files as Readonly<Record<string, string>>)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([name, value]) => [name, Buffer.byteLength(value)]),
	);
}

export function explainCommittedSeed(seed: CommittedSeedV1): CliExplanationV1 {
	verifyCommittedSeed(seed);
	const files = fileBytes(seed.files);
	const totalBytes = Object.values(files).reduce(
		(total, value) => total + Number(value),
		0,
	);
	const steps = seed.steps.map((step) => ({
		stepId: step.stepId,
		kind: step.kind,
		collection: step.collection,
	}));
	return {
		format: "questpie.cli-explanation",
		version: 1,
		command: "seed status",
		status: "committed",
		facts: {
			identity: seed.identity,
			checksum: seed.checksum,
			dependencies: seed.dependencies,
			files,
			totalBytes,
			steps,
		},
		human: [
			`seed ${seed.identity}`,
			"status committed",
			`checksum ${seed.checksum}`,
			`dependencies ${seed.dependencies.length === 0 ? "none" : seed.dependencies.join(", ")}`,
			`files ${Object.keys(files).length} (${totalBytes} bytes)`,
			...steps.map(
				(step, index) =>
					`step ${String(index + 1).padStart(2, "0")} ${step.kind} ${step.collection} ${step.stepId}`,
			),
		],
	};
}
