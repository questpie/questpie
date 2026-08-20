import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type FrozenEvidenceExemption = Readonly<{
	path: string;
	reason: string;
	supersededBy: string;
}>;

export type Projection = Readonly<{
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
		criterion: string;
		retained: string[];
		frozenEvidenceExemptions: FrozenEvidenceExemption[];
	}>;
	authorityProjection: string[];
}>;

const REPOSITORY_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../..",
);

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
	"docs/adr/0004-prove-one-tracer-before-capability-breadth.md",
	"docs/adr/0017-freeze-multi-instance-and-optional-acceleration.md",
	"docs/adr/0019-freeze-semantic-kernels-and-public-surface.md",
	"docs/adr/0021-slice-the-beta-one-release.md",
	"docs/adr/0025-remove-channels-from-core.md",
	"docs/v4/beta1-build-spec.md",
	"docs/v4/design-fiction/realtime.md",
	"docs/v4/documentation-plan.md",
	"docs/v4/implementation-gates.md",
	"docs/v4/live-query-and-change-ledger.md",
	"docs/v4/multi-instance-and-optional-acceleration.md",
	"docs/v4/product-area-matrix.md",
	"docs/v4/prototypes/api-ergonomics-gate/CAPABILITY-MAP.md",
	"docs/v4/questpie-v4-vision-for-martin.md",
	"docs/v4/research/framework-api-atlas/DECISION-MAP.md",
	"docs/v4/research/framework-api-atlas/PROOF-MAP.md",
	"docs/v4/semantic-kernels-and-public-surface.md",
	"docs/v4/visuals/architecture.html",
] as const;

const REQUIRED_FROZEN_EVIDENCE = [
	"docs/v4/prototypes/beta-slice-p15/SLICE.json",
	"docs/v4/prototypes/implementation-collapse-p16/QUEUE.json",
	"docs/v4/prototypes/conformance-p14/MATRIX.md",
	"docs/v4/prototypes/conformance-p14/check.ts",
	"docs/v4/research/convex-comparison.md",
	"docs/v4/research/supabase-v3-v4-comparison.md",
	"docs/v4/research/framework-api-atlas/v3-realtime-durable-jobs.md",
] as const;

const CORE_CHANNEL_MARKERS = [
	/defineChannel/,
	/runtime\.channelCarrier/,
	/Channel Resource/,
	/Channel payload/,
	/Channel event/,
	/Channel replay/,
	/Channel authority/,
	/Channel presence/,
	/Channel carrier/,
	/typed Channels/i,
	/generic Channels/i,
	/Channels\/event streams/,
	/Channels capabilities/,
	/ephemeral Channels/i,
	/explicit Channels/i,
	/KV, Channels/,
	/channels, OpenAPI/i,
	/Channel\/Live Query/,
	/Channel ownership/,
	/Channel and optional carrier/,
	/Channel is an authored/,
	/"capability": "Channel"/,
	/\| Channels\s+\|/,
] as const;

function listFiles(directory: string, extension: string): string[] {
	return readdirSync(join(REPOSITORY_ROOT, directory), {
		withFileTypes: true,
	}).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return listFiles(path, extension);
		return entry.isFile() && path.endsWith(extension) ? [path] : [];
	});
}

function currentAuthorityFiles(): string[] {
	return [
		"HANDOFF.md",
		"SPEC.md",
		"CONTEXT.md",
		...listFiles("docs/adr", ".md"),
		...readdirSync(join(REPOSITORY_ROOT, "docs/v4"), {
			withFileTypes: true,
		})
			.filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
			.map((entry) => `docs/v4/${entry.name}`),
		...listFiles("apps/docs/content/docs/v4", ".mdx"),
		"docs/v4/design-fiction/realtime.md",
		"docs/v4/prototypes/api-ergonomics-gate/CAPABILITY-MAP.md",
		"docs/v4/research/framework-api-atlas/DECISION-MAP.md",
		"docs/v4/research/framework-api-atlas/PROOF-MAP.md",
		"docs/v4/visuals/architecture.html",
	];
}

function markerNames(path: string): string[] {
	const source = readFileSync(join(REPOSITORY_ROOT, path), "utf8");
	const markers = CORE_CHANNEL_MARKERS.filter((marker) =>
		marker.test(source),
	).map((marker) => marker.source);
	if (
		(REQUIRED_FROZEN_EVIDENCE as readonly string[]).includes(path) &&
		/Channel/.test(source)
	)
		markers.push("historical Channel assertion");
	return markers;
}

export function scanRepositoryAuthority(projection: Projection): {
	currentChannelPaths: string[];
	frozenChannelPaths: string[];
} {
	const projectionSet = new Set(projection.authorityProjection);
	const currentChannelPaths = [...new Set(currentAuthorityFiles())]
		.filter((path) => markerNames(path).length > 0)
		.sort();
	const uncovered = currentChannelPaths.filter(
		(path) => !projectionSet.has(path),
	);
	if (uncovered.length > 0)
		throw new Error(
			`Channel-bearing current authority missing from projection: ${uncovered.join(", ")}`,
		);

	const exemptionPaths =
		projection.historicalEvidence.frozenEvidenceExemptions.map(
			(item) => item.path,
		);
	const frozenChannelPaths = REQUIRED_FROZEN_EVIDENCE.filter(
		(path) => markerNames(path).length > 0,
	);
	const unclassifiedFrozen = frozenChannelPaths.filter(
		(path) => !exemptionPaths.includes(path),
	);
	if (unclassifiedFrozen.length > 0)
		throw new Error(
			`Channel-bearing frozen evidence is not explicitly exempt: ${unclassifiedFrozen.join(", ")}`,
		);

	return { currentChannelPaths, frozenChannelPaths };
}

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
	const historical = projection.historicalEvidence;
	if (
		historical.rewrite !== false ||
		historical.criterion !==
			"Accepted proof artifacts, manifests, and review records retain the exact claim reviewed at their pinned head; permanent maps and current ADR, product, gate, build, public-documentation, visual, and wayfinder surfaces project the new decision." ||
		![
			"accepted proof heads and manifests",
			"historical review records",
			"v3 behavioral evidence",
		].every((item) => historical.retained.includes(item))
	)
		throw new Error("historical evidence boundary is incomplete");
	exactMembers(
		historical.frozenEvidenceExemptions.map((item) => item.path),
		REQUIRED_FROZEN_EVIDENCE,
		"frozen evidence exemption set",
	);
	for (const exemption of historical.frozenEvidenceExemptions) {
		if (
			!exemption.reason ||
			!(REQUIRED_PROJECTIONS as readonly string[]).includes(
				exemption.supersededBy,
			)
		)
			throw new Error(
				`frozen evidence exemption is unjustified: ${exemption.path}`,
			);
	}
	exactMembers(
		projection.authorityProjection,
		REQUIRED_PROJECTIONS,
		"authority projection set",
	);
	for (const path of projection.authorityProjection) {
		if (
			path !== "docs/adr/0025-remove-channels-from-core.md" &&
			!existsSync(join(REPOSITORY_ROOT, path))
		)
			throw new Error(`projected authority does not exist: ${path}`);
	}
	scanRepositoryAuthority(projection);
}

if (import.meta.main) {
	const projection = JSON.parse(
		readFileSync(new URL("./PROJECTION.json", import.meta.url), "utf8"),
	) as Projection;
	validate(projection);
	const scan = scanRepositoryAuthority(projection);
	console.log(
		`Channel removal projection: ${projection.frameworkSurface.absent.length} framework surfaces absent; ${scan.currentChannelPaths.length} current authority files covered; ${scan.frozenChannelPaths.length} frozen evidence files explicitly exempt; domain Channel preserved`,
	);
}
