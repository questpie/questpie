import { randomUUID } from "node:crypto";

export const ACCEPTANCE_REVIEW_PROFILE_V2 = Object.freeze({
	protocolVersion: 2 as const,
	transport: "codex-cli" as const,
	model: "gpt-5.6-sol" as const,
	effort: "medium" as const,
	axes: ["spec", "standards"] as const,
});

export type AcceptanceReviewAxisV2 =
	(typeof ACCEPTANCE_REVIEW_PROFILE_V2.axes)[number];

export type AcceptanceReviewRequestV2 = {
	axis: AcceptanceReviewAxisV2;
	requestId: string;
	packet: string;
	packetDigest: string;
	reviewedHead: string;
	diffBase: string;
	timeoutMs: number;
	prompt: string;
};

export type AcceptanceReviewerTransportResult = {
	exitCode: number;
	timedOut: boolean;
	stderr: string;
	events: string;
	finalResponse: string;
};

export type AcceptanceReviewerTransport = (
	request: AcceptanceReviewRequestV2,
) => Promise<AcceptanceReviewerTransportResult>;

export type AcceptanceReviewV2 = {
	axis: AcceptanceReviewAxisV2;
	model: typeof ACCEPTANCE_REVIEW_PROFILE_V2.model;
	effort: typeof ACCEPTANCE_REVIEW_PROFILE_V2.effort;
	requestId: string;
	invocationId: string;
	packetDigest: string;
	reviewedHead: string;
	diffBase: string;
	verdict: "PASS" | "BLOCKED";
	findings: string;
};

export type ContingencyAcceptanceReviewV2 = {
	profile: typeof ACCEPTANCE_REVIEW_PROFILE_V2;
	verdict: "PASS" | "BLOCKED";
	reviews: readonly [AcceptanceReviewV2, AcceptanceReviewV2];
};

export type PrimaryAcceptanceReviewV2 =
	| {
			disposition: "PASS" | "BLOCKED";
			findings: string;
	  }
	| {
			disposition: "NO_RESULT";
			category: "timeout" | "transport" | "empty" | "invalid";
	  };

export class AcceptanceReviewNoResult extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AcceptanceReviewNoResult";
	}
}

type ReviewResponse = Omit<AcceptanceReviewV2, "invocationId"> & {
	protocolVersion: 2;
};

const RESPONSE_KEYS = [
	"axis",
	"diffBase",
	"effort",
	"findings",
	"model",
	"packetDigest",
	"protocolVersion",
	"requestId",
	"reviewedHead",
	"verdict",
] as const;

function noResult(message: string): never {
	throw new AcceptanceReviewNoResult(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
): boolean {
	const actual = Object.keys(value).sort();
	return (
		actual.length === expected.length &&
		expected.every((key, index) => actual[index] === key)
	);
}

function parseEvents(events: string, finalResponse: string): string {
	let invocationId: string | undefined;
	let completed = false;
	let agentMessage: string | undefined;

	for (const line of events.split("\n")) {
		if (line.trim() === "") continue;
		let event: unknown;
		try {
			event = JSON.parse(line);
		} catch {
			noResult("Codex emitted malformed JSON events");
		}
		if (!isRecord(event) || typeof event.type !== "string")
			noResult("Codex emitted an invalid event");

		switch (event.type) {
			case "thread.started":
				if (invocationId || typeof event.thread_id !== "string")
					noResult("Codex emitted an invalid invocation identity");
				invocationId = event.thread_id;
				break;
			case "turn.started":
				break;
			case "item.started":
			case "item.completed": {
				if (!isRecord(event.item) || typeof event.item.type !== "string")
					noResult("Codex emitted an invalid item event");
				if (event.item.type === "reasoning") break;
				if (event.item.type !== "agent_message")
					noResult(`Codex reviewer used prohibited tool ${event.item.type}`);
				if (event.type !== "item.completed" || agentMessage !== undefined)
					noResult("Codex emitted an invalid final message sequence");
				if (typeof event.item.text !== "string")
					noResult("Codex final message is not text");
				agentMessage = event.item.text;
				break;
			}
			case "turn.completed":
				if (completed) noResult("Codex emitted duplicate completion events");
				completed = true;
				break;
			default:
				noResult(`Codex emitted unsupported event ${event.type}`);
		}
	}

	if (!invocationId || !completed || agentMessage !== finalResponse)
		noResult("Codex event transcript does not bind the final response");
	return invocationId;
}

function decodeResponse(
	request: AcceptanceReviewRequestV2,
	transport: AcceptanceReviewerTransportResult,
): AcceptanceReviewV2 {
	if (transport.timedOut) noResult(`${request.axis} reviewer timed out`);
	if (transport.exitCode !== 0)
		noResult(`${request.axis} reviewer transport failed`);
	if (transport.finalResponse.trim() === "")
		noResult(`${request.axis} reviewer returned an empty response`);

	const invocationId = parseEvents(
		transport.events,
		transport.finalResponse.trim(),
	);
	let decoded: unknown;
	try {
		decoded = JSON.parse(transport.finalResponse);
	} catch {
		noResult(`${request.axis} reviewer returned malformed JSON`);
	}
	if (!isRecord(decoded) || !exactKeys(decoded, RESPONSE_KEYS))
		noResult(`${request.axis} reviewer returned the wrong response shape`);

	const response = decoded as ReviewResponse;
	if (
		response.protocolVersion !== 2 ||
		response.axis !== request.axis ||
		response.model !== ACCEPTANCE_REVIEW_PROFILE_V2.model ||
		response.effort !== ACCEPTANCE_REVIEW_PROFILE_V2.effort ||
		response.requestId !== request.requestId ||
		response.packetDigest !== request.packetDigest ||
		response.reviewedHead !== request.reviewedHead ||
		response.diffBase !== request.diffBase ||
		(response.verdict !== "PASS" && response.verdict !== "BLOCKED") ||
		typeof response.findings !== "string"
	)
		noResult(`${request.axis} reviewer response is not bound to its request`);

	const verdicts = [
		...response.findings.matchAll(/^VERDICT:\s*(PASS|BLOCKED)\s*$/gm),
	].map((match) => match[1]);
	if (
		verdicts.length !== 1 ||
		!response.findings.startsWith("VERDICT:") ||
		verdicts[0] !== response.verdict
	)
		noResult(`${request.axis} reviewer returned an invalid verdict`);

	return Object.freeze({
		axis: response.axis,
		model: response.model,
		effort: response.effort,
		requestId: response.requestId,
		invocationId,
		packetDigest: response.packetDigest,
		reviewedHead: response.reviewedHead,
		diffBase: response.diffBase,
		verdict: response.verdict,
		findings: response.findings,
	});
}

function promptFor(request: Omit<AcceptanceReviewRequestV2, "prompt">): string {
	const task =
		request.axis === "spec"
			? "Review specification fidelity: authority, behavior, scope, ownership, invariants, hostile coverage, and whether every acceptance claim is proved."
			: "Review repository Standards: code and module quality, test strength, determinism, portability, truthful gates and measurements, dead or duplicate surfaces, and review-protocol safety.";
	return `${request.packet}\n<contingency_review_request>\n${task}\nReview only the packet above. Do not invoke tools or inspect any other state. Return one JSON object with exactly these fields and values where fixed:\n${JSON.stringify(
		{
			protocolVersion: 2,
			axis: request.axis,
			model: ACCEPTANCE_REVIEW_PROFILE_V2.model,
			effort: ACCEPTANCE_REVIEW_PROFILE_V2.effort,
			requestId: request.requestId,
			packetDigest: request.packetDigest,
			reviewedHead: request.reviewedHead,
			diffBase: request.diffBase,
			verdict: "PASS or BLOCKED",
			findings:
				"Must start with exactly one VERDICT: PASS or VERDICT: BLOCKED line, followed by grounded findings and non-blocking observations.",
		},
		null,
		2,
	)}\nA PASS means no blocking finding remains. A BLOCKED finding must name the affected file and exact repair or missing evidence.\n</contingency_review_request>\n`;
}

export async function runContingencyAcceptanceReview(
	input: {
		packet: string;
		packetDigest: string;
		reviewedHead: string;
		diffBase: string;
		timeoutMs: number;
	},
	transport: AcceptanceReviewerTransport,
): Promise<ContingencyAcceptanceReviewV2> {
	if (!/^[0-9a-f]{64}$/.test(input.packetDigest))
		noResult("packet digest is not canonical SHA-256");
	if (
		!/^([0-9a-f]{40})$/.test(input.reviewedHead) ||
		!/^([0-9a-f]{40})$/.test(input.diffBase)
	)
		noResult("review commit identity is not a full commit ID");
	if (!Number.isSafeInteger(input.timeoutMs) || input.timeoutMs < 1_000)
		noResult("review timeout is invalid");

	const requests = ACCEPTANCE_REVIEW_PROFILE_V2.axes.map((axis) => {
		const base = {
			axis,
			requestId: randomUUID(),
			...input,
		};
		return Object.freeze({ ...base, prompt: promptFor(base) });
	});
	let transports: AcceptanceReviewerTransportResult[];
	try {
		transports = await Promise.all(requests.map(transport));
	} catch {
		noResult("contingency reviewer transport failed");
	}
	const reviews = requests.map((request, index) =>
		decodeResponse(request, transports[index]!),
	) as [AcceptanceReviewV2, AcceptanceReviewV2];
	if (reviews[0].invocationId === reviews[1].invocationId)
		noResult("contingency reviewers reused one invocation identity");

	return Object.freeze({
		profile: ACCEPTANCE_REVIEW_PROFILE_V2,
		verdict: reviews.some((review) => review.verdict === "BLOCKED")
			? "BLOCKED"
			: "PASS",
		reviews: Object.freeze(reviews),
	});
}

export async function resolveAcceptanceReview(
	primary: PrimaryAcceptanceReviewV2,
	runContingency: () => Promise<ContingencyAcceptanceReviewV2>,
): Promise<{
	verdict: "PASS" | "BLOCKED";
	contingency?: ContingencyAcceptanceReviewV2;
}> {
	if (primary.disposition !== "NO_RESULT")
		return Object.freeze({ verdict: primary.disposition });
	const contingency = await runContingency();
	return Object.freeze({ verdict: contingency.verdict, contingency });
}
