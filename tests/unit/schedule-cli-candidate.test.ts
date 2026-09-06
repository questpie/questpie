import { expect, test } from "bun:test";

import {
	requestedScheduleRevision,
	scheduleFailureMessage,
} from "../../packages/questpie/cli/schedule";

test("schedule activate requires one exact canonical decimal expected revision", () => {
	for (const revision of ["0", "1", "9007199254740993", "9223372036854775807"])
		expect(
			requestedScheduleRevision(["activate", "--expect-revision", revision]),
		).toBe(revision);
	for (const args of [
		[],
		["activate"],
		["activate", "--expect-revision"],
		["activate", "--expect-revision", "01"],
		["activate", "--expect-revision", "-1"],
		["activate", "--expect-revision", "1.0"],
		["activate", "--expect-revision", "9223372036854775808"],
		["activate", "--expect-revision", "1e3"],
		["activate", "--expect-revision", " 1"],
		["activate", "--expect-revision", "0", "--force"],
		["activate", "--expect-revision", "0", "--expect-revision", "1"],
		["activate", "--force"],
		["list"],
	])
		expect(() => requestedScheduleRevision(args)).toThrow(
			"SCHEDULE_ARGUMENTS_INVALID",
		);
});

test("activation diagnostics retain only safe revisions and digests, including an absent head", () => {
	expect(
		scheduleFailureMessage(
			Object.assign(new Error("SCHEDULE_ACTIVATION_STALE"), {
				currentHead: undefined,
			}),
		),
	).toBe("SCHEDULE_ACTIVATION_STALE");
	expect(
		scheduleFailureMessage(
			new Error("postgres://localhost/private-diagnostic"),
		),
	).toBe("SCHEDULE_ACTIVATION_FAILED");
	expect(
		scheduleFailureMessage(
			Object.assign(new Error("SCHEDULE_ACTIVATION_STALE"), {
				currentHead: {
					revision: "2",
					targetDigest: "a".repeat(64),
					contextJson: "secret",
				},
			}),
		),
	).toBe(
		`SCHEDULE_ACTIVATION_STALE ${JSON.stringify({ revision: "2", targetDigest: "a".repeat(64) })}`,
	);
});
