import { expect, test } from "bun:test";
import { resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import { projectPostgresMutationTransactionStatements } from "../../packages/compiler/src/mutation";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");
const compilationPromise = compileApplication({ applicationRoot: fixtureRoot });

const identities = [
	"mutation.dispatch.event.insert",
	"mutation.dispatch.intent.accept",
	"mutation.dispatch.intent.insert",
	"mutation.dispatch.kernel.mark",
	"mutation.dispatch.run.insert",
	"mutation.receipt.claim",
	"mutation.receipt.commit",
	"mutation.receipt.read",
] as const;

type MutableArtifact = ReturnType<
	typeof projectPostgresMutationTransactionStatements
> & {
	statements: Array<Record<string, unknown>>;
};

async function runtimeLinker() {
	await compilationPromise;
	return import("../../packages/runtime/src/mutation");
}

async function rehash(artifact: MutableArtifact): Promise<void> {
	const { runtimeArtifactDigest } =
		await import("../../packages/runtime/src/application/artifact-protocol");
	const { digest: _digest, ...unsigned } = artifact;
	artifact.digest = runtimeArtifactDigest(
		"questpie-postgres-mutation-transaction-statements-v1",
		unsigned,
	);
}

test("Runtime Build binds the compiled fixed Mutation statement artifact", async () => {
	const compilation = await compilationPromise;
	const artifact = JSON.parse(
		compilation.generatedFiles[
			"postgres-mutation-transaction-statements.json"
		]!,
	);
	const runtimeBuild = JSON.parse(
		compilation.generatedFiles["runtime-build.json"]!,
	);

	expect(
		artifact.statements.map(({ identity }: { identity: string }) => identity),
	).toEqual([
		"mutation.dispatch.event.insert",
		"mutation.dispatch.intent.accept",
		"mutation.dispatch.intent.insert",
		"mutation.dispatch.kernel.mark",
		"mutation.dispatch.run.insert",
		"mutation.receipt.claim",
		"mutation.receipt.commit",
		"mutation.receipt.read",
	]);
	expect(runtimeBuild.postgresMutationTransactionStatementsDigest).toBe(
		artifact.digest,
	);
	const application = compilation.generatedFiles["internal/application.js"]!;
	expect(application).toContain(
		`expectedMutationTransactionStatementsDigest="${artifact.digest}"`,
	);
	expect(
		application.indexOf(
			"generated Mutation transaction statements do not match Runtime Build",
		),
	).toBeLessThan(application.indexOf("new SQL"));
	expect(application).toContain("linkPostgresMutationTransactionStatements({");

	const { decodeRuntimeArtifacts } =
		await import("../../packages/runtime/src/application/artifacts");
	const { verifyRuntimeArtifactFiles } =
		await import("../../packages/runtime/src/application/artifact-files");
	const runtimeArtifacts = decodeRuntimeArtifacts({
		runtimeBuild,
		runtimeExecutables: JSON.parse(
			compilation.generatedFiles["runtime-executables.json"]!,
		),
		operationContracts: JSON.parse(
			compilation.generatedFiles["operation-contracts.json"]!,
		),
		wireContract: JSON.parse(compilation.generatedFiles["wire-contract.json"]!),
	});
	const inventoryFiles = Object.fromEntries(
		runtimeBuild.inventory.map(({ path }: { path: string }) => [
			path,
			compilation.generatedFiles[path]!,
		]),
	);
	expect(() =>
		verifyRuntimeArtifactFiles(runtimeArtifacts, inventoryFiles),
	).not.toThrow();
});

test("compiler projects the complete fixed Mutation transaction statement set", async () => {
	const artifact = projectPostgresMutationTransactionStatements();
	const { linkPostgresMutationTransactionStatements } = await runtimeLinker();
	const linked = linkPostgresMutationTransactionStatements({
		artifact: JSON.stringify(artifact),
		expectedDigest: artifact.digest,
	});

	expect(artifact.statements.map(({ identity }) => identity)).toEqual(
		identities,
	);
	expect(linked.statements.map(({ identity }) => identity)).toEqual(identities);
	expect(
		linked.statements.every(({ statement }) => Object.isFrozen(statement)),
	).toBe(true);
});

test("linker rejects a fully rehashed surplus statement", async () => {
	const artifact = structuredClone(
		projectPostgresMutationTransactionStatements(),
	) as MutableArtifact;
	artifact.statements.push({
		...structuredClone(artifact.statements.at(-1)!),
		identity: "mutation.surplus",
	});
	await rehash(artifact);
	const { linkPostgresMutationTransactionStatements } = await runtimeLinker();

	expect(() =>
		linkPostgresMutationTransactionStatements({
			artifact: JSON.stringify(artifact),
			expectedDigest: artifact.digest,
		}),
	).toThrow("complete fixed statement set");
});

test("linker rejects fully rehashed statement grammar widening", async () => {
	const artifact = structuredClone(
		projectPostgresMutationTransactionStatements(),
	) as MutableArtifact;
	artifact.statements[0]!.runtimeSql = true;
	await rehash(artifact);
	const { linkPostgresMutationTransactionStatements } = await runtimeLinker();

	expect(() =>
		linkPostgresMutationTransactionStatements({
			artifact: JSON.stringify(artifact),
			expectedDigest: artifact.digest,
		}),
	).toThrow("statement keys");
});

test("linker rejects a fully rehashed placeholder gap", async () => {
	const artifact = structuredClone(
		projectPostgresMutationTransactionStatements(),
	) as MutableArtifact;
	const claim = artifact.statements.find(
		(statement) => statement.identity === "mutation.receipt.claim",
	)!;
	claim.text = String(claim.text).replace("$7", "$6");
	await rehash(artifact);
	const { linkPostgresMutationTransactionStatements } = await runtimeLinker();

	expect(() =>
		linkPostgresMutationTransactionStatements({
			artifact: JSON.stringify(artifact),
			expectedDigest: artifact.digest,
		}),
	).toThrow("placeholders");
});

test("linker rejects a fully rehashed zero placeholder", async () => {
	const artifact = structuredClone(
		projectPostgresMutationTransactionStatements(),
	) as MutableArtifact;
	artifact.statements[0]!.text = `${String(artifact.statements[0]!.text)} $0`;
	await rehash(artifact);
	const { linkPostgresMutationTransactionStatements } = await runtimeLinker();

	expect(() =>
		linkPostgresMutationTransactionStatements({
			artifact: JSON.stringify(artifact),
			expectedDigest: artifact.digest,
		}),
	).toThrow("placeholders");
});

test("linker rejects a fully rehashed decoder-contract forgery", async () => {
	const artifact = structuredClone(
		projectPostgresMutationTransactionStatements(),
	) as MutableArtifact;
	const receipt = artifact.statements.find(
		(statement) => statement.identity === "mutation.receipt.read",
	)!;
	const result = receipt.result as {
		columns: Array<{ codec: string }>;
	};
	result.columns[2]!.codec = "text";
	await rehash(artifact);
	const { linkPostgresMutationTransactionStatements } = await runtimeLinker();

	expect(() =>
		linkPostgresMutationTransactionStatements({
			artifact: JSON.stringify(artifact),
			expectedDigest: artifact.digest,
		}),
	).toThrow("fixed result contract");
});

test("digest authority rejects SQL replacement before statement construction", async () => {
	const original = projectPostgresMutationTransactionStatements();
	const artifact = structuredClone(original) as MutableArtifact;
	artifact.statements[0]!.text = "";
	await rehash(artifact);
	const { linkPostgresMutationTransactionStatements } = await runtimeLinker();

	expect(() =>
		linkPostgresMutationTransactionStatements({
			artifact: JSON.stringify(artifact),
			expectedDigest: original.digest,
		}),
	).toThrow("statements digest");
});

test("linked decoders enforce fixed PostgreSQL result shapes", async () => {
	const artifact = projectPostgresMutationTransactionStatements();
	const { linkPostgresMutationTransactionStatements } = await runtimeLinker();
	const linked = linkPostgresMutationTransactionStatements({
		artifact: JSON.stringify(artifact),
		expectedDigest: artifact.digest,
	});
	const claim = linked.get("mutation.receipt.claim")!.statement;
	const operationTime = new Date("2026-08-21T00:00:00.000Z");

	expect(
		claim.decode({
			command: "INSERT",
			rowCount: 1,
			rows: [["901", operationTime]],
		}),
	).toEqual([{ transactionId: "901", operationTime }]);
	expect(
		Object.isFrozen(
			claim.decode({
				command: "INSERT",
				rowCount: 0,
				rows: [],
			}),
		),
	).toBe(true);
	for (const invalid of [
		{ command: "SELECT", rowCount: 1, rows: [["901", operationTime]] },
		{ command: "INSERT", rowCount: null, rows: [] },
		{ command: "INSERT", rowCount: 2, rows: [] },
		{ command: "INSERT", rowCount: 1, rows: [] },
		{ command: "INSERT", rowCount: 1, rows: [["901"]] },
		{ command: "INSERT", rowCount: 1, rows: [[null, operationTime]] },
		{ command: "INSERT", rowCount: 1, rows: [["901", "not-a-date"]] },
	] as const)
		expect(() => claim.decode(invalid)).toThrow();
});
