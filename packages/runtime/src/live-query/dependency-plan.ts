import { canonicalJsonLine, sha256Digest } from "../canonical-json";
import type {
	LiveQueryDependencyTokenKind,
	LiveQueryDependencyTokenV1,
	ObservedLiveQueryPlanV1,
} from "./observation";
import type { ChangeLedgerFactV1 } from "./postgres";

const digestPattern = /^[0-9a-f]{64}$/;
const tokenKinds = new Set<LiveQueryDependencyTokenKind>([
	"contextBootstrapPoint",
	"collectionPoint",
	"collectionRange",
	"orderingBoundary",
	"pageSentinel",
	"policyEvidencePoint",
	"relationEndpoint",
	"relationMiss",
	"tenantPartition",
]);

function invalid(detail = "is invalid"): never {
	throw new TypeError(`observed Live Query plan ${detail}`);
}

function exactKeys(
	value: Readonly<Record<string, unknown>>,
	expected: readonly string[],
): boolean {
	const actual = Object.keys(value).toSorted();
	const sortedExpected = [...expected].toSorted();
	return (
		actual.length === sortedExpected.length &&
		actual.every((key, index) => key === sortedExpected[index])
	);
}

function decodeToken(
	value: unknown,
	index: number,
): LiveQueryDependencyTokenV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
	const token = value as Readonly<Record<string, unknown>>;
	if (!exactKeys(token, ["kind", "collection", "detail"])) invalid();
	if (
		typeof token.kind !== "string" ||
		!tokenKinds.has(token.kind as LiveQueryDependencyTokenKind)
	)
		invalid(`token ${index} kind is invalid`);
	if (
		typeof token.collection !== "string" ||
		!token.collection.startsWith("collection:")
	)
		invalid(`token ${index} Collection is invalid`);
	if (
		!token.detail ||
		typeof token.detail !== "object" ||
		Array.isArray(token.detail)
	)
		invalid(`token ${index} detail is invalid`);
	return Object.freeze({
		kind: token.kind as LiveQueryDependencyTokenKind,
		collection: token.collection,
		detail: Object.freeze({
			...(token.detail as Readonly<Record<string, unknown>>),
		}),
	});
}

function normalizedQueryIdentity(identity: string): string {
	return identity.startsWith("query:")
		? identity.slice("query:".length)
		: identity;
}

export function decodeObservedLiveQueryPlan(
	input: Readonly<{
		bytes: Uint8Array;
		bytesDigest: string;
		queryIdentity: string;
	}>,
): ObservedLiveQueryPlanV1 {
	if (
		!(input.bytes instanceof Uint8Array) ||
		input.bytes.byteLength > 262_144 ||
		input.bytes.byteLength === 0
	)
		invalid("bytes are invalid");
	if (
		!digestPattern.test(input.bytesDigest) ||
		sha256Digest(input.bytes) !== input.bytesDigest
	)
		invalid("bytes digest does not match");
	let decoded: unknown;
	try {
		decoded = JSON.parse(
			new TextDecoder("utf-8", { fatal: true }).decode(input.bytes),
		);
	} catch {
		invalid();
	}
	if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
		invalid();
	const plan = decoded as Readonly<Record<string, unknown>>;
	if (!exactKeys(plan, ["format", "version", "query", "tokens", "digest"]))
		invalid();
	if (
		plan.format !== "questpie.observed-live-query-plan" ||
		plan.version !== 1 ||
		typeof plan.query !== "string" ||
		normalizedQueryIdentity(plan.query) !==
			normalizedQueryIdentity(input.queryIdentity)
	)
		invalid("Query identity does not match");
	if (!Array.isArray(plan.tokens) || plan.tokens.length > 256) invalid();
	const tokens = Object.freeze(plan.tokens.map(decodeToken));
	const canonicalTokens = tokens.map((token) =>
		Buffer.from(canonicalJsonLine(token)).toString("utf8"),
	);
	if (
		canonicalTokens.some(
			(token, index) => index > 0 && canonicalTokens[index - 1]! >= token,
		)
	)
		invalid("tokens must be sorted and unique");
	if (typeof plan.digest !== "string" || !digestPattern.test(plan.digest))
		invalid("embedded digest is invalid");
	const withoutDigest = {
		format: "questpie.observed-live-query-plan" as const,
		version: 1 as const,
		query: plan.query,
		tokens,
	};
	const embeddedDigest = sha256Digest(
		Buffer.concat([
			Buffer.from("questpie-observed-live-query-plan-v1\0"),
			canonicalJsonLine(withoutDigest),
		]),
	);
	if (plan.digest !== embeddedDigest) invalid("embedded digest does not match");
	const result = Object.freeze({ ...withoutDigest, digest: embeddedDigest });
	if (!Buffer.from(canonicalJsonLine(result)).equals(Buffer.from(input.bytes)))
		invalid("bytes are not canonical");
	return result;
}

export function matchesObservedLiveQueryPlan(
	plan: ObservedLiveQueryPlanV1,
	fact: ChangeLedgerFactV1,
): boolean {
	return plan.tokens.some((token) => token.collection === fact.collection);
}
