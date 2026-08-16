import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { compileApplication } from "@questpie/compiler";

import { decodeRuntimeArtifacts } from "../../packages/runtime/src/application/artifacts";

const fixtureRoot = resolve(import.meta.dir, "../../fixtures/collaboration");

function canonical(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	const source = value as Readonly<Record<string, unknown>>;
	return `{${Object.keys(source)
		.sort()
		.map((key) => `${JSON.stringify(key)}:${canonical(source[key])}`)
		.join(",")}}`;
}

function digest(domain: string, value: unknown): string {
	return createHash("sha256")
		.update(`${domain}\0${canonical(value)}\n`)
		.digest("hex");
}

test("compiler emits exact wire v2 and binds its same-contract v1 sibling", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-wire-v2-"));
	try {
		await cp(fixtureRoot, temporary, { recursive: true });
		const compilation = await compileApplication({
			applicationRoot: temporary,
		});
		const wire = JSON.parse(compilation.generatedFiles["wire-contract.json"]!);
		const v2Failures = [...wire.failures];
		expect(wire.format).toBe("questpie.operation-wire");
		expect(wire.version).toBe(2);
		expect(wire.failures).toContain("COMMITTED_RESULT_UNAVAILABLE");
		expect(wire.resultKinds).toEqual(["declaredError", "failure", "result"]);
		expect(wire.failureDetails).toEqual({
			ordinary: ["code", "retryable"],
			committedResultUnavailable: ["code", "retryable", "transactionId"],
		});
		expect(wire.compatibility).toMatchObject({
			clientContractDigest: wire.clientContractDigest,
			wireV1Source: "sameApplicationClientContractAndOperations",
			wireV1MutationExecution: "rejectBeforeContextAndOperation",
			wireV1QueryExecution: "allowed",
		});
		const {
			failureDetails: _failureDetails,
			resultKinds: _resultKinds,
			callIdentity: _callIdentity,
			transactionIdentity: _transactionIdentity,
			committedResultUnavailable: _committed,
			compatibility,
			digest: _wireV2Digest,
			...shared
		} = wire;
		const siblingV1 = {
			...shared,
			version: 1,
			failures: v2Failures.filter(
				(code: string) => code !== "COMMITTED_RESULT_UNAVAILABLE",
			),
		};
		expect(compatibility.wireV1Digest).toBe(
			digest("questpie-operation-wire-v1", siblingV1),
		);

		const runtimeBuild = JSON.parse(
			compilation.generatedFiles["runtime-build.json"]!,
		);
		const runtimeExecutables = JSON.parse(
			compilation.generatedFiles["runtime-executables.json"]!,
		);
		expect(() =>
			decodeRuntimeArtifacts({
				runtimeBuild,
				runtimeExecutables,
				wireContract: wire,
			}),
		).not.toThrow();
		for (const hostile of [
			{
				...wire,
				callIdentity: { ...wire.callIdentity, maximumUnicodeScalars: 257 },
			},
			{
				...wire,
				failureDetails: {
					...wire.failureDetails,
					ordinary: ["code", "retryable", "transactionId"],
				},
			},
			{
				...wire,
				compatibility: { ...wire.compatibility, wireV1Digest: "0".repeat(64) },
			},
			{
				...wire,
				compatibility: {
					...wire.compatibility,
					clientContractDigest: "0".repeat(64),
				},
			},
		])
			expect(() =>
				decodeRuntimeArtifacts({
					runtimeBuild,
					runtimeExecutables,
					wireContract: hostile,
				}),
			).toThrow();
	} finally {
		await rm(temporary, { force: true, recursive: true });
	}
}, 30_000);
