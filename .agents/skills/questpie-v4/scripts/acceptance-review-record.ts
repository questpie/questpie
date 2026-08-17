import {
	PRIMARY_DIAGNOSTIC_LIMIT,
	type PrimaryAcceptanceReviewV2,
} from "./claude-acceptance-primary";

type PrimaryRecord = PrimaryAcceptanceReviewV2 & {
	profile: "claude-opus-medium-v1";
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
		const hasDiagnostic = Object.hasOwn(value, "diagnostic");
		if (
			!exactKeys(value, [
				"category",
				"disposition",
				"profile",
				...(hasDiagnostic ? ["diagnostic"] : []),
			]) ||
			!(["timeout", "transport", "empty", "invalid"] as unknown[]).includes(
				value.category,
			)
		)
			invalid("record has an invalid primary no-result disposition");
		if (
			hasDiagnostic &&
			(typeof value.diagnostic !== "string" ||
				value.diagnostic === "" ||
				value.diagnostic.length > PRIMARY_DIAGNOSTIC_LIMIT ||
				value.diagnostic.trim() !== value.diagnostic ||
				/\s\s|[\n\r\t]/.test(value.diagnostic))
		)
			invalid("record has an unbounded or unsanitized primary diagnostic");
		return value as PrimaryRecord;
	}
	if (
		!exactKeys(value, ["disposition", "findings", "profile"]) ||
		!validFindings(value.findings, value.disposition)
	)
		invalid("record has an invalid primary verdict");
	return value as PrimaryRecord;
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
	// `NO_RESULT` is terminal here. There is one reviewer, so a record that
	// carries no verdict cannot also carry an aggregate one.
	if (primary.disposition === "NO_RESULT")
		invalid("primary no-result cannot be recorded as an acceptance verdict");
	if (value.verdict !== primary.disposition)
		invalid("record verdict does not equal the primary verdict");
	return value as AcceptanceReviewRecordV2;
}
