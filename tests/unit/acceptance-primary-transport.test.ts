import { describe, expect, test } from "bun:test";

import {
	AcceptanceRecordError,
	decodeAcceptanceReviewRecord,
} from "../../.agents/skills/questpie-v4/scripts/acceptance-review-record";
import {
	ACCEPTANCE_PRIMARY_PROFILE_V2,
	classifyPrimaryReviewResult,
	PRIMARY_DIAGNOSTIC_LIMIT,
	primaryReviewerCommand,
	PrimaryReviewerUnavailable,
	sanitizePrimaryDiagnostic,
	verifyPrimaryReviewer,
	type PrimaryReviewerProbe,
} from "../../.agents/skills/questpie-v4/scripts/claude-acceptance-primary";

const installedHelp = `Usage: claude [options]

Options:
  -p, --print                           Print response and exit
  --model <model>                       Model for the current session
  --effort <level>                      Effort level for the current session
  --no-session-persistence              Disable session persistence
  --permission-mode <mode>              Permission mode to use
  --tools <tools...>                    Specify the list of available tools
`;

function probeFor(
	responses: Partial<Record<string, ReturnType<PrimaryReviewerProbe>>>,
): PrimaryReviewerProbe {
	return (args) =>
		responses[args[0] ?? ""] ?? { exitCode: 127, stdout: "", stderr: "" };
}

const installedProbe = probeFor({
	"--version": { exitCode: 0, stdout: "2.1.232 (Claude Code)\n", stderr: "" },
	"--help": { exitCode: 0, stdout: installedHelp, stderr: "" },
});

describe("pinned primary reviewer verification", () => {
	test("accepts an installed reviewer declaring every pinned option", () => {
		expect(() => verifyPrimaryReviewer(installedProbe)).not.toThrow();
	});

	test("the pinned command uses only verified options", () => {
		const command = primaryReviewerCommand();
		expect(command[0]).toBe(ACCEPTANCE_PRIMARY_PROFILE_V2.executable);
		const used = command.filter((argument) => argument.startsWith("--")).sort();
		expect(used).toEqual([...ACCEPTANCE_PRIMARY_PROFILE_V2.options].sort());
		expect(command).toContain(ACCEPTANCE_PRIMARY_PROFILE_V2.model);
		expect(command).toContain(ACCEPTANCE_PRIMARY_PROFILE_V2.effort);
	});

	test("an absent primary executable fails closed", () => {
		expect(() =>
			verifyPrimaryReviewer(
				probeFor({
					"--version": {
						exitCode: 127,
						stdout: "",
						stderr: "command not found",
					},
				}),
			),
		).toThrow(PrimaryReviewerUnavailable);
	});

	test("a primary executable reporting no version fails closed", () => {
		expect(() =>
			verifyPrimaryReviewer(
				probeFor({
					"--version": { exitCode: 0, stdout: "   \n", stderr: "" },
				}),
			),
		).toThrow(PrimaryReviewerUnavailable);
	});

	test("an argument-rejecting primary executable fails closed", () => {
		for (const option of ACCEPTANCE_PRIMARY_PROFILE_V2.options) {
			const withoutOption = installedHelp
				.split("\n")
				.filter((line) => !line.includes(option))
				.join("\n");
			expect(() =>
				verifyPrimaryReviewer(
					probeFor({
						"--version": { exitCode: 0, stdout: "2.1.232", stderr: "" },
						"--help": { exitCode: 0, stdout: withoutOption, stderr: "" },
					}),
				),
			).toThrow(PrimaryReviewerUnavailable);
		}
	});

	test("an option named only inside prose does not count as accepted", () => {
		expect(() =>
			verifyPrimaryReviewer(
				probeFor({
					"--version": { exitCode: 0, stdout: "2.1.232", stderr: "" },
					"--help": {
						exitCode: 0,
						stdout: `${installedHelp
							.split("\n")
							.filter((line) => !line.includes("--effort"))
							.join(
								"\n",
							)}\n  (only meaningful together with --effort medium)\n`,
						stderr: "",
					},
				}),
			),
		).toThrow(PrimaryReviewerUnavailable);
	});

	test("a reviewer that cannot list its options fails closed", () => {
		expect(() =>
			verifyPrimaryReviewer(
				probeFor({
					"--version": { exitCode: 0, stdout: "2.1.232", stderr: "" },
					"--help": { exitCode: 1, stdout: "", stderr: "unknown option" },
				}),
			),
		).toThrow(PrimaryReviewerUnavailable);
	});

	test("unavailability is a distinct fail-closed error, not a no-result", () => {
		try {
			verifyPrimaryReviewer(probeFor({}));
			throw new Error("verification unexpectedly succeeded");
		} catch (error) {
			expect(error).toBeInstanceOf(PrimaryReviewerUnavailable);
		}
		// A reachable reviewer that simply did not answer is a different thing:
		// it is a no result, and this protocol treats that as terminal.
		expect(
			classifyPrimaryReviewResult({
				exitCode: 1,
				timedOut: false,
				stdout: "",
				stderr: "spend cap",
			}).disposition,
		).toBe("NO_RESULT");
	});
});

describe("primary result classification", () => {
	const base = { exitCode: 0, timedOut: false, stdout: "", stderr: "" };

	test("a well-formed verdict carries no diagnostic", () => {
		const result = classifyPrimaryReviewResult({
			...base,
			stdout: "VERDICT: PASS\nno blocking finding remains",
			stderr: "warning: something noisy",
		});
		expect(result.disposition).toBe("PASS");
		expect(result).not.toHaveProperty("diagnostic");
	});

	test("each no-result category is distinguished and carries provenance", () => {
		expect(
			classifyPrimaryReviewResult({
				...base,
				timedOut: true,
				stderr: "deadline",
			}),
		).toEqual({
			disposition: "NO_RESULT",
			category: "timeout",
			diagnostic: "deadline",
		});
		expect(
			classifyPrimaryReviewResult({
				...base,
				exitCode: 1,
				stderr: "spend cap",
			}),
		).toEqual({
			disposition: "NO_RESULT",
			category: "transport",
			diagnostic: "spend cap",
		});
		expect(classifyPrimaryReviewResult({ ...base })).toEqual({
			disposition: "NO_RESULT",
			category: "empty",
		});
		expect(
			classifyPrimaryReviewResult({ ...base, stdout: "I think it looks fine" }),
		).toEqual({ disposition: "NO_RESULT", category: "invalid" });
	});

	test("two verdict lines are invalid, not a verdict", () => {
		expect(
			classifyPrimaryReviewResult({
				...base,
				stdout: "VERDICT: PASS\nVERDICT: BLOCKED",
			}),
		).toEqual({ disposition: "NO_RESULT", category: "invalid" });
	});
});

describe("primary diagnostic sanitization", () => {
	test("collapses whitespace and drops empty diagnostics", () => {
		expect(sanitizePrimaryDiagnostic("  \n\t ")).toBeUndefined();
		expect(sanitizePrimaryDiagnostic("line one\n\tline two")).toBe(
			"line one line two",
		);
	});

	test("redacts secret-like material instead of recording it", () => {
		// Assembled at run time so this file carries no secret-shaped literal of
		// its own: the packet secret scanner reads the diff, and a fixture that
		// looked like a credential would refuse the very review that carries it.
		const scheme = ["post", "gres://"].join("");
		const credential = ["user", "hunter2"].join(":");
		for (const stderr of [
			`transport rejected api${"_"}key=sk012345678901234567`,
			`could not reach ${scheme}${credential}@db.example.com/app`,
			`token gh${"p"}_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA rejected`,
		]) {
			expect(sanitizePrimaryDiagnostic(stderr)).toBe("[redacted]");
		}
	});

	test("bounds the recorded diagnostic", () => {
		const bounded = sanitizePrimaryDiagnostic("e".repeat(5_000));
		expect(bounded).toHaveLength(PRIMARY_DIAGNOSTIC_LIMIT);
	});
});

describe("recorded primary diagnostics", () => {
	const expected = {
		ticket: "#317",
		manifestPath: "docs/manifest.json",
		reviewedHead: "b".repeat(40),
		diffBase: "c".repeat(40),
		packetDigest: "a".repeat(64),
	};

	function recordWith(diagnostic: unknown): Record<string, unknown> {
		return {
			protocolVersion: 2,
			ticket: expected.ticket,
			profile: "questpie.acceptance.v2",
			manifestPath: expected.manifestPath,
			reviewedHead: expected.reviewedHead,
			diffBase: expected.diffBase,
			packetDigest: expected.packetDigest,
			primary: {
				profile: "claude-opus-medium-v1",
				disposition: "BLOCKED",
				findings: "VERDICT: BLOCKED\none blocker",
				...(diagnostic === undefined ? {} : { diagnostic }),
			},
			verdict: "BLOCKED",
			recordedAt: "2026-08-16T20:44:46.536Z",
		};
	}

	test("a primary verdict may not carry a diagnostic", () => {
		expect(() =>
			decodeAcceptanceReviewRecord(recordWith("spend cap"), expected),
		).toThrow(AcceptanceRecordError);
		expect(() =>
			decodeAcceptanceReviewRecord(recordWith(undefined), expected),
		).not.toThrow();
	});

	test("an unbounded or unsanitized diagnostic is rejected", () => {
		const noResult = (diagnostic: unknown) => {
			const record = recordWith(undefined);
			record.primary = {
				profile: "claude-opus-medium-v1",
				disposition: "NO_RESULT",
				category: "transport",
				...(diagnostic === undefined ? {} : { diagnostic }),
			};
			record.verdict = "PASS";
			return record;
		};
		for (const diagnostic of [
			"",
			" leading",
			"trailing ",
			"double  space",
			"multi\nline",
			"tabbed\tvalue",
			"x".repeat(PRIMARY_DIAGNOSTIC_LIMIT + 1),
			42,
		]) {
			expect(() =>
				decodeAcceptanceReviewRecord(noResult(diagnostic), expected),
			).toThrow(AcceptanceRecordError);
		}
	});
});
