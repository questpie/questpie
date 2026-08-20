import { readFileSync } from "node:fs";

type Projection = Readonly<{
	version: number;
	decision: string;
	frameworkSurface: Readonly<{
		absent: string[];
		replacements: string[];
	}>;
	ownership: Readonly<Record<string, string>>;
	providerBoundary: Readonly<Record<string, string>>;
	domainPreservation: Readonly<Record<string, string>>;
	supersedes: string[];
	historicalEvidence: Readonly<{
		rewrite: boolean;
		retained: string[];
	}>;
	authorityProjection: string[];
}>;

const REQUIRED_ABSENCES = [
	"Channel Resource",
	"defineChannel",
	"generated Channel client",
	"Channel event codec projection",
	"Channel PostgreSQL ledger",
	"Channel replay or resume",
	"Channel authority generation",
	"Channel presence model",
	"runtime.channelCarrier",
] as const;

const REQUIRED_SUPERSESSIONS = [
	"ADR-0017 Channel Resource and Pusher-compatible carrier clauses",
	"ADR-0019 defineChannel, Channel payload, and runtime.channelCarrier clauses",
	"ADR-0021 future Channel-compatible seam",
	"P14 Channel conformance requirement",
	"current authority that presents Channels as current or deferred QUESTPIE scope",
] as const;

const REQUIRED_PROJECTIONS = [
	"HANDOFF.md",
	"SPEC.md",
	"CONTEXT.md",
	"docs/adr/README.md",
	"docs/adr/0017-freeze-multi-instance-and-optional-acceleration.md",
	"docs/adr/0019-freeze-semantic-kernels-and-public-surface.md",
	"docs/adr/0021-slice-the-beta-one-release.md",
	"docs/adr/0025-remove-channels-from-core.md",
	"docs/v4/beta1-build-spec.md",
	"docs/v4/implementation-gates.md",
	"docs/v4/multi-instance-and-optional-acceleration.md",
	"docs/v4/product-area-matrix.md",
	"docs/v4/semantic-kernels-and-public-surface.md",
] as const;

function exactMembers(
	actual: string[],
	expected: readonly string[],
	label: string,
) {
	if (
		actual.length !== expected.length ||
		expected.some((member) => !actual.includes(member))
	)
		throw new Error(`${label} is incomplete`);
}

export function validate(projection: Projection): void {
	if (projection.version !== 1 || projection.decision !== "removeCoreChannels")
		throw new Error("removal decision identity is invalid");
	exactMembers(
		projection.frameworkSurface.absent,
		REQUIRED_ABSENCES,
		"framework absence set",
	);
	if (projection.frameworkSurface.replacements.length !== 0)
		throw new Error("a replacement core realtime concept was introduced");

	const ownership = projection.ownership;
	if (
		ownership.durableAuthorizedClientState !==
			"Query.watch, Change Ledger, and PostgreSQL" ||
		ownership.durableBusinessHistory !== "ordinary Collection and Query" ||
		ownership.postCommitWork !== "Reaction or Job" ||
		ownership.externalPublishAttempt !== "Action or external-effect Service" ||
		ownership.transientDelivery !== "application and provider integration" ||
		ownership.providerPresence !== "advisory provider connection state" ||
		ownership.businessAuthorization !==
			"QUESTPIE Policy over ordinary application facts" ||
		ownership.generatedChannelTypes !== "absent"
	)
		throw new Error("post-removal ownership is incomplete");

	const provider = projection.providerBoundary;
	for (const key of [
		"providerRegistry",
		"compilerAbi",
		"runtimeBinding",
		"durableAuthority",
		"operationAuthority",
	])
		if (provider[key] !== "absent")
			throw new Error(`provider gained forbidden authority: ${key}`);
	if (
		provider.composition !== "ordinary application or Package code" ||
		provider.deliveryGuarantee !== "fire-and-forget" ||
		provider.reactionGuarantee !==
			"durable acceptance and at-least-once publish attempts; provider delivery may remain ambiguous"
	)
		throw new Error("provider or Reaction guarantee is invalid");

	if (
		projection.domainPreservation.fixtureGraph !==
			"Company -> Space -> Channel -> Membership -> Message" ||
		projection.domainPreservation.channelMeaning !==
			"ordinary application Collection and domain noun"
	)
		throw new Error("domain Channel was not preserved");

	exactMembers(
		projection.supersedes,
		REQUIRED_SUPERSESSIONS,
		"supersession set",
	);
	if (
		projection.historicalEvidence.rewrite !== false ||
		![
			"accepted proof heads and manifests",
			"historical review records",
			"v3 behavioral evidence",
		].every((item) => projection.historicalEvidence.retained.includes(item))
	)
		throw new Error("historical evidence would be rewritten or lost");
	exactMembers(
		projection.authorityProjection,
		REQUIRED_PROJECTIONS,
		"authority projection set",
	);
}

if (import.meta.main) {
	const projection = JSON.parse(
		readFileSync(new URL("./PROJECTION.json", import.meta.url), "utf8"),
	) as Projection;
	validate(projection);
	console.log(
		`Channel removal projection: ${projection.frameworkSurface.absent.length} framework surfaces absent, domain Channel preserved`,
	);
}
