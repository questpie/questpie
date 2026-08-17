import { createHash } from "node:crypto";

import {
	failRuntimeArtifact as fail,
	runtimeArtifactDigest as artifactDigest,
	runtimeArtifactRecord as record,
} from "./artifact-protocol";
import type { RuntimeArtifactsV1 } from "./artifacts";

export function verifyRuntimeArtifactFiles(
	artifacts: RuntimeArtifactsV1,
	files: Readonly<Record<string, Uint8Array | string>>,
): void {
	const build = artifacts.runtimeBuild;
	const paths = Object.keys(files).sort();
	const expectedPaths = build.inventory.map((item) => item.path);
	if (
		paths.length !== expectedPaths.length ||
		expectedPaths.some((path, index) => path !== paths[index])
	)
		fail("artifact file inventory does not match");
	for (const item of build.inventory) {
		const bytes = files[item.path];
		if (bytes === undefined) fail(`artifact file ${item.path} is missing`);
		const actual = createHash("sha256").update(bytes).digest("hex");
		if (actual !== item.digest)
			fail(`artifact file ${item.path} digest does not match`);
	}
	const server = files["internal/application.js"];
	if (server === undefined)
		fail("artifact file internal/application.js is missing");
	if (
		createHash("sha256").update(server).digest("hex") !==
		build.serverBundleDigest
	)
		fail("server bundle digest does not match");
	const parseJsonFile = (path: string): unknown => {
		const bytes = files[path];
		if (bytes === undefined) fail(`artifact file ${path} is missing`);
		try {
			return JSON.parse(
				typeof bytes === "string"
					? bytes
					: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
			);
		} catch {
			fail(`artifact file ${path} is not canonical JSON`);
		}
	};
	if (
		artifactDigest(
			"questpie-runtime-executables-v1",
			parseJsonFile("runtime-executables.json"),
		) !== build.runtimeExecutablesDigest
	)
		fail("runtime-executables.json semantic digest does not match");
	if (
		artifactDigest(
			"questpie-operation-contracts-v1",
			parseJsonFile("operation-contracts.json"),
		) !== build.operationContractsDigest
	)
		fail("operation-contracts.json semantic digest does not match");
	const rawWire = record(
		parseJsonFile("wire-contract.json"),
		"wire-contract.json",
	);
	const { digest: rawWireDigest, ...rawWireUnsigned } = rawWire;
	const wireVersion = rawWire.version;
	if (
		rawWireDigest !== build.wireDigest ||
		artifactDigest(
			wireVersion === 2
				? "questpie-operation-wire-v2"
				: "questpie-operation-wire-v1",
			rawWireUnsigned,
		) !== build.wireDigest
	)
		fail("wire-contract.json semantic digest does not match");
	if (
		build.later.reactionDigest !== null &&
		artifactDigest(
			"questpie-reaction-projection-v2",
			parseJsonFile("reaction-projection.json"),
		) !== build.later.reactionDigest
	)
		fail("reaction-projection.json semantic digest does not match");
	if (build.later.durableCompatibilityDigest !== null) {
		const kernel = record(
			parseJsonFile("durable-kernel.json"),
			"durable-kernel.json",
		);
		const { digest: kernelDigest, ...unsigned } = kernel;
		if (
			kernelDigest !== build.later.durableCompatibilityDigest ||
			artifactDigest("questpie-durable-kernel-v1", unsigned) !==
				build.later.durableCompatibilityDigest
		)
			fail("durable-kernel.json semantic digest does not match");
	}
	if (
		build.realtimeWireDigest !== null &&
		artifactDigest(
			"questpie-realtime-wire-v1",
			(() => {
				const realtime = record(
					parseJsonFile("realtime-wire-contract.json"),
					"realtime-wire-contract.json",
				);
				const { digest: realtimeDigest, ...unsigned } = realtime;
				if (realtimeDigest !== build.realtimeWireDigest)
					fail("realtime wire digest does not match");
				return unsigned;
			})(),
		) !== build.realtimeWireDigest
	)
		fail("realtime-wire-contract.json semantic digest does not match");
	if (
		build.later.changeLedgerDigest !== null &&
		artifactDigest(
			"questpie:p4:changeLedgerProjection:v1",
			parseJsonFile("change-ledger.json"),
		) !== build.later.changeLedgerDigest
	)
		fail("change-ledger.json semantic digest does not match");
	if (
		build.later.resumeDigest !== null &&
		artifactDigest(
			"questpie:p4:resumeProjection:v1",
			parseJsonFile("live-query-resume.json"),
		) !== build.later.resumeDigest
	)
		fail("live-query-resume.json semantic digest does not match");
}
