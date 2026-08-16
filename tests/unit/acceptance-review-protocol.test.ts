import { describe, expect, test } from "bun:test";

import {
	ACCEPTANCE_REVIEW_PROFILE_V2,
	AcceptanceReviewNoResult,
	resolveAcceptanceReview,
	runContingencyAcceptanceReview,
	type AcceptanceReviewRequestV2,
	type AcceptanceReviewerTransport,
} from "../../.agents/skills/questpie-v4/scripts/acceptance-review-protocol";
import {
	AcceptanceRecordError,
	decodeAcceptanceReviewRecord,
} from "../../.agents/skills/questpie-v4/scripts/acceptance-review-record";
import { createAcceptanceResponseSchema } from "../../.agents/skills/questpie-v4/scripts/codex-acceptance-reviewer";

const packet = "<documents>bounded acceptance packet</documents>";
const packetDigest = "a".repeat(64);
const reviewedHead = "b".repeat(40);
const diffBase = "c".repeat(40);

function completedResponse(
	request: AcceptanceReviewRequestV2,
	verdict: "PASS" | "BLOCKED" = "PASS",
) {
	const response = JSON.stringify({
		protocolVersion: 2,
		axis: request.axis,
		model: ACCEPTANCE_REVIEW_PROFILE_V2.model,
		effort: ACCEPTANCE_REVIEW_PROFILE_V2.effort,
		requestId: request.requestId,
		packetDigest: request.packetDigest,
		reviewedHead: request.reviewedHead,
		diffBase: request.diffBase,
		verdict,
		findings:
			verdict === "PASS"
				? "VERDICT: PASS\n\nNo blocking findings."
				: "VERDICT: BLOCKED\n\n- concrete blocker",
	});
	const threadId = `thread-${request.axis}`;
	return {
		exitCode: 0,
		timedOut: false,
		stderr: "",
		finalResponse: response,
		events: [
			JSON.stringify({ type: "thread.started", thread_id: threadId }),
			JSON.stringify({ type: "turn.started" }),
			JSON.stringify({
				type: "item.completed",
				item: { id: "item_0", type: "agent_message", text: response },
			}),
			JSON.stringify({ type: "turn.completed", usage: {} }),
		].join("\n"),
	};
}

function transport(
	change?: (
		request: AcceptanceReviewRequestV2,
		response: ReturnType<typeof completedResponse>,
	) => ReturnType<typeof completedResponse>,
): AcceptanceReviewerTransport {
	return async (request) => {
		const response = completedResponse(request);
		return change?.(request, response) ?? response;
	};
}

describe("acceptance review protocol v2", () => {
	test("emits a closed structured-output schema with an explicit type for every property", () => {
		const request: AcceptanceReviewRequestV2 = {
			axis: "spec",
			requestId: "request",
			packet,
			packetDigest,
			reviewedHead,
			diffBase,
			timeoutMs: 300_000,
			prompt: "review",
		};
		const schema = createAcceptanceResponseSchema(request);
		expect(schema.additionalProperties).toBe(false);
		expect(Object.keys(schema.properties).sort()).toEqual(
			[...schema.required].sort(),
		);
		expect(
			Object.values(schema.properties).every((property) => property.type),
		).toBe(true);
	});

	test("requires independent unanimous Spec and Standards reviews over one packet", async () => {
		const result = await runContingencyAcceptanceReview(
			{ packet, packetDigest, reviewedHead, diffBase, timeoutMs: 300_000 },
			transport(),
		);

		expect(result.verdict).toBe("PASS");
		expect(result.reviews.map((review) => review.axis)).toEqual([
			"spec",
			"standards",
		]);
		expect(
			new Set(result.reviews.map((review) => review.invocationId)).size,
		).toBe(2);
		expect(
			result.reviews.every((review) => review.packetDigest === packetDigest),
		).toBe(true);
	});

	test("aggregates one concrete blocker as BLOCKED", async () => {
		const result = await runContingencyAcceptanceReview(
			{ packet, packetDigest, reviewedHead, diffBase, timeoutMs: 300_000 },
			async (request) =>
				completedResponse(
					request,
					request.axis === "spec" ? "BLOCKED" : "PASS",
				),
		);

		expect(result.verdict).toBe("BLOCKED");
		expect(result.reviews.map((review) => review.verdict)).toEqual([
			"BLOCKED",
			"PASS",
		]);
	});

	test.each([
		{
			name: "transport failure",
			change: (
				_request: AcceptanceReviewRequestV2,
				response: ReturnType<typeof completedResponse>,
			) => ({
				...response,
				exitCode: 1,
				stderr: "provider unavailable",
			}),
		},
		{
			name: "timeout",
			change: (
				_request: AcceptanceReviewRequestV2,
				response: ReturnType<typeof completedResponse>,
			) => ({
				...response,
				timedOut: true,
			}),
		},
		{
			name: "tool use",
			change: (
				_request: AcceptanceReviewRequestV2,
				response: ReturnType<typeof completedResponse>,
			) => ({
				...response,
				events: `${response.events}\n${JSON.stringify({
					type: "item.completed",
					item: { id: "item_1", type: "command_execution", command: "pwd" },
				})}`,
			}),
		},
		{
			name: "response binding mismatch",
			change: (
				_request: AcceptanceReviewRequestV2,
				response: ReturnType<typeof completedResponse>,
			) => ({
				...response,
				finalResponse: response.finalResponse.replace(
					packetDigest,
					"d".repeat(64),
				),
			}),
		},
		{
			name: "duplicate verdict",
			change: (
				_request: AcceptanceReviewRequestV2,
				response: ReturnType<typeof completedResponse>,
			) => ({
				...response,
				finalResponse: response.finalResponse.replace(
					"No blocking findings.",
					"VERDICT: PASS",
				),
			}),
		},
	])("records no result for $name", async ({ change }) => {
		await expect(
			runContingencyAcceptanceReview(
				{ packet, packetDigest, reviewedHead, diffBase, timeoutMs: 300_000 },
				transport(change),
			),
		).rejects.toBeInstanceOf(AcceptanceReviewNoResult);
	});

	test("rejects reused reviewer invocation identity", async () => {
		await expect(
			runContingencyAcceptanceReview(
				{ packet, packetDigest, reviewedHead, diffBase, timeoutMs: 300_000 },
				transport((_request, response) => ({
					...response,
					events: response.events.replace(
						/thread-(spec|standards)/,
						"shared-thread",
					),
				})),
			),
		).rejects.toBeInstanceOf(AcceptanceReviewNoResult);
	});

	test("does not invoke contingency after a primary verdict", async () => {
		for (const verdict of ["PASS", "BLOCKED"] as const) {
			let calls = 0;
			const result = await resolveAcceptanceReview(
				{ disposition: verdict, findings: `VERDICT: ${verdict}` },
				async () => {
					calls += 1;
					throw new Error("contingency must not run");
				},
			);
			expect(result).toEqual({ verdict });
			expect(calls).toBe(0);
		}
	});

	test("invokes exactly one contingency round only after primary no-result", async () => {
		let calls = 0;
		const contingency = await runContingencyAcceptanceReview(
			{ packet, packetDigest, reviewedHead, diffBase, timeoutMs: 300_000 },
			transport(),
		);
		const result = await resolveAcceptanceReview(
			{ disposition: "NO_RESULT", category: "transport" },
			async () => {
				calls += 1;
				return contingency;
			},
		);
		expect(calls).toBe(1);
		expect(result).toEqual({ verdict: "PASS", contingency });
	});

	test("classifies a thrown contingency transport as no result", async () => {
		await expect(
			runContingencyAcceptanceReview(
				{ packet, packetDigest, reviewedHead, diffBase, timeoutMs: 300_000 },
				async () => {
					throw new Error("missing executable");
				},
			),
		).rejects.toBeInstanceOf(AcceptanceReviewNoResult);
	});

	test("verifies one packet-bound contingency record and rejects tampering", async () => {
		const contingency = await runContingencyAcceptanceReview(
			{ packet, packetDigest, reviewedHead, diffBase, timeoutMs: 300_000 },
			transport(),
		);
		const expected = {
			ticket: "#317",
			manifestPath:
				"docs/v4/prototypes/acceptance-protocol-v2/acceptance-manifest.json",
			reviewedHead,
			diffBase,
			packetDigest,
		};
		const record = {
			protocolVersion: 2,
			ticket: expected.ticket,
			profile: "questpie.acceptance.v2",
			manifestPath: expected.manifestPath,
			reviewedHead,
			diffBase,
			packetDigest,
			primary: {
				profile: "claude-opus-medium-v1",
				disposition: "NO_RESULT",
				category: "transport",
			},
			contingency,
			verdict: "PASS",
			recordedAt: "2026-08-16T12:00:00.000Z",
		};

		expect(decodeAcceptanceReviewRecord(record, expected).verdict).toBe("PASS");
		for (const mutate of [
			(value: Record<string, unknown>) => {
				value.packetDigest = "d".repeat(64);
			},
			(value: Record<string, unknown>) => {
				value.verdict = "BLOCKED";
			},
			(value: Record<string, unknown>) => {
				const contingencyValue = value.contingency as {
					reviews: Array<Record<string, unknown>>;
				};
				contingencyValue.reviews[1]!.axis = "spec";
			},
			(value: Record<string, unknown>) => {
				const contingencyValue = value.contingency as {
					reviews: Array<Record<string, unknown>>;
				};
				contingencyValue.reviews[1]!.invocationId =
					contingencyValue.reviews[0]!.invocationId;
			},
			(value: Record<string, unknown>) => {
				const contingencyValue = value.contingency as {
					reviews: Array<Record<string, unknown>>;
				};
				contingencyValue.reviews[0]!.model = "weaker-model";
			},
			(value: Record<string, unknown>) => {
				delete value.contingency;
			},
		]) {
			const changed = structuredClone(record) as Record<string, unknown>;
			mutate(changed);
			expect(() => decodeAcceptanceReviewRecord(changed, expected)).toThrow(
				AcceptanceRecordError,
			);
		}
	});
});
