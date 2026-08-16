import {
	ACCEPTANCE_REVIEW_PROFILE_V2,
	type AcceptanceReviewV2,
	type ContingencyAcceptanceReviewV2,
} from "./acceptance-review-protocol";

type PrimaryRecord =
	| {
			profile: "claude-opus-medium-v1";
			disposition: "PASS" | "BLOCKED";
			findings: string;
	  }
	| {
			profile: "claude-opus-medium-v1";
			disposition: "NO_RESULT";
			category: "timeout" | "transport" | "empty" | "invalid";
	  };

export type AcceptanceReviewRecordV2 = {
	protocolVersion: 2;
	ticket: string;
	profile: "questpie.acceptance.v2";
	manifestPath: string;
	reviewedHead: string;
	diffBase: string;
	packetDigest: string;
	primary: PrimaryRecord;
	contingency?: ContingencyAcceptanceReviewV2;
	verdict: "PASS" | "BLOCKED";
	recordedAt: string;
};

export class AcceptanceRecordError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AcceptanceRecordError";
	}
}

function invalid(message: string): never {
	throw new AcceptanceRecordError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: object, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const sorted = [...expected].sort();
	return (
		actual.length === sorted.length &&
		sorted.every((key, index) => actual[index] === key)
	);
}

function validFindings(
	findings: unknown,
	verdict: unknown,
): findings is string {
	if (
		typeof findings !== "string" ||
		(verdict !== "PASS" && verdict !== "BLOCKED")
	)
		return false;
	const verdicts = [
		...findings.matchAll(/^VERDICT:\s*(PASS|BLOCKED)\s*$/gm),
	].map((match) => match[1]);
	return (
		verdicts.length === 1 &&
		findings.startsWith("VERDICT:") &&
		verdicts[0] === verdict
	);
}

function decodePrimary(value: unknown): PrimaryRecord {
	if (!isRecord(value) || value.profile !== "claude-opus-medium-v1")
		invalid("record has an invalid primary profile");
	if (value.disposition === "NO_RESULT") {
		if (
			!exactKeys(value, ["category", "disposition", "profile"]) ||
			!(["timeout", "transport", "empty", "invalid"] as unknown[]).includes(
				value.category,
			)
		)
			invalid("record has an invalid primary no-result disposition");
		return value as PrimaryRecord;
	}
	if (
		!exactKeys(value, ["disposition", "findings", "profile"]) ||
		!validFindings(value.findings, value.disposition)
	)
		invalid("record has an invalid primary verdict");
	return value as PrimaryRecord;
}

function decodeContingencyReview(
	value: unknown,
	expected: {
		axis: "spec" | "standards";
		reviewedHead: string;
		diffBase: string;
		packetDigest: string;
	},
): AcceptanceReviewV2 {
	if (
		!isRecord(value) ||
		!exactKeys(value, [
			"axis",
			"diffBase",
			"effort",
			"findings",
			"invocationId",
			"model",
			"packetDigest",
			"requestId",
			"reviewedHead",
			"verdict",
		]) ||
		value.axis !== expected.axis ||
		value.model !== ACCEPTANCE_REVIEW_PROFILE_V2.model ||
		value.effort !== ACCEPTANCE_REVIEW_PROFILE_V2.effort ||
		value.reviewedHead !== expected.reviewedHead ||
		value.diffBase !== expected.diffBase ||
		value.packetDigest !== expected.packetDigest ||
		typeof value.requestId !== "string" ||
		value.requestId === "" ||
		typeof value.invocationId !== "string" ||
		value.invocationId === "" ||
		!validFindings(value.findings, value.verdict)
	)
		invalid(`record has an invalid ${expected.axis} contingency review`);
	return value as AcceptanceReviewV2;
}

function decodeContingency(
	value: unknown,
	expected: {
		reviewedHead: string;
		diffBase: string;
		packetDigest: string;
	},
): ContingencyAcceptanceReviewV2 {
	const profile =
		isRecord(value) && isRecord(value.profile) ? value.profile : {};
	if (
		!isRecord(value) ||
		!exactKeys(value, ["profile", "reviews", "verdict"]) ||
		!exactKeys(profile, [
			"axes",
			"effort",
			"model",
			"protocolVersion",
			"transport",
		]) ||
		profile.protocolVersion !== 2 ||
		profile.transport !== "codex-cli" ||
		profile.model !== ACCEPTANCE_REVIEW_PROFILE_V2.model ||
		profile.effort !== ACCEPTANCE_REVIEW_PROFILE_V2.effort ||
		!Array.isArray(profile.axes) ||
		profile.axes.length !== 2 ||
		profile.axes[0] !== "spec" ||
		profile.axes[1] !== "standards" ||
		!Array.isArray(value.reviews) ||
		value.reviews.length !== 2
	)
		invalid("record has an invalid contingency profile");
	const reviews = [
		decodeContingencyReview(value.reviews[0], { axis: "spec", ...expected }),
		decodeContingencyReview(value.reviews[1], {
			axis: "standards",
			...expected,
		}),
	] as const;
	if (
		reviews[0].requestId === reviews[1].requestId ||
		reviews[0].invocationId === reviews[1].invocationId
	)
		invalid("record reuses contingency reviewer identity");
	const aggregate = reviews.some((review) => review.verdict === "BLOCKED")
		? "BLOCKED"
		: "PASS";
	if (value.verdict !== aggregate)
		invalid("record has an invalid contingency aggregate verdict");
	return value as ContingencyAcceptanceReviewV2;
}

export function decodeAcceptanceReviewRecord(
	value: unknown,
	expected: {
		ticket: string;
		manifestPath: string;
		reviewedHead: string;
		diffBase: string;
		packetDigest: string;
	},
): AcceptanceReviewRecordV2 {
	if (!isRecord(value)) invalid("acceptance record is not an object");
	const hasContingency = Object.hasOwn(value, "contingency");
	if (
		!exactKeys(value, [
			"diffBase",
			"manifestPath",
			"packetDigest",
			"primary",
			"profile",
			"protocolVersion",
			"recordedAt",
			"reviewedHead",
			"ticket",
			"verdict",
			...(hasContingency ? ["contingency"] : []),
		]) ||
		value.protocolVersion !== 2 ||
		value.profile !== "questpie.acceptance.v2" ||
		value.ticket !== expected.ticket ||
		value.manifestPath !== expected.manifestPath ||
		value.reviewedHead !== expected.reviewedHead ||
		value.diffBase !== expected.diffBase ||
		value.packetDigest !== expected.packetDigest ||
		(value.verdict !== "PASS" && value.verdict !== "BLOCKED") ||
		typeof value.recordedAt !== "string" ||
		Number.isNaN(Date.parse(value.recordedAt)) ||
		new Date(value.recordedAt).toISOString() !== value.recordedAt
	)
		invalid("acceptance record is not bound to the prepared packet");

	const primary = decodePrimary(value.primary);
	if (primary.disposition === "NO_RESULT") {
		if (!hasContingency)
			invalid("primary no-result lacks the required contingency round");
		const contingency = decodeContingency(value.contingency, expected);
		if (value.verdict !== contingency.verdict)
			invalid("record verdict does not equal the contingency verdict");
	} else {
		if (hasContingency)
			invalid("primary verdict cannot be replaced by a contingency round");
		if (value.verdict !== primary.disposition)
			invalid("record verdict does not equal the primary verdict");
	}
	return value as AcceptanceReviewRecordV2;
}
