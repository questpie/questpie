import { expect, test } from "bun:test";

import { digest } from "../../packages/compiler/src/canonical";
import { createPostgresStaticSchedules } from "../../packages/runtime/src/durable/schedule";
import { verifyStaticScheduleArtifact } from "../../packages/runtime/src/durable/schedule/artifact";

const bindings = {
	application: "application:schedule-proof",
	compilerRuntimeBuildDigest: "a".repeat(64),
	jobProjectionDigest: "b".repeat(64),
};
const artifact = () => ({
	format: "questpie.job-schedules",
	version: 1,
	...bindings,
	schedules: [],
	digest: digest("questpie-job-schedule-set-v1", {
		application: bindings.application,
		schedules: [],
	}),
});

test("activation revision grammar fails before opening a transaction", async () => {
	let transactions = 0;
	const owner = createPostgresStaticSchedules({
		artifact: artifact(),
		bindings,
		database: {
			transaction: async () => {
				transactions++;
				throw new Error("unexpected database work");
			},
		},
		accept: async () => {
			throw new Error("unexpected acceptance");
		},
	});
	for (const expectedRevision of [
		"-1",
		"01",
		"1.0",
		"9223372036854775808",
		"",
		"1e1",
	]) {
		await expect(owner.activate({ expectedRevision })).rejects.toThrow(
			"SCHEDULE_STATE_INVALID",
		);
	}
	expect(transactions).toBe(0);
});

test("schedule artifact snapshots verified bytes and rejects cross-pin and content tampering", () => {
	const source = artifact();
	const verified = verifyStaticScheduleArtifact(source, bindings);
	expect(verified.digest).toBe(source.digest);
	expect(Object.isFrozen(verified)).toBe(true);
	expect(Object.isFrozen(verified.schedules)).toBe(true);
	for (const key of [
		"compilerRuntimeBuildDigest",
		"jobProjectionDigest",
		"digest",
	] as const) {
		expect(() =>
			verifyStaticScheduleArtifact(
				{ ...source, [key]: "c".repeat(64) },
				bindings,
			),
		).toThrow("SCHEDULE_ARTIFACT_INVALID");
	}
	expect(() =>
		verifyStaticScheduleArtifact({ ...source, extra: true }, bindings),
	).toThrow("SCHEDULE_ARTIFACT_INVALID");
});
