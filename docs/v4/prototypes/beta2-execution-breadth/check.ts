import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

type Projection = Readonly<{
	version: number;
	decision: string;
	routeAuth: Readonly<Record<string, string | boolean>>;
	action: Readonly<{
		owns: string[];
		context: string[];
		forbiddenContext: string[];
		automaticRetry: boolean;
		durableEffectIdentityOwner: string;
		effectIdentity: Readonly<Record<string, string | boolean>>;
		providerGuarantee: string;
	}>;
	job: Readonly<{
		publicResources: string[];
		absentPublicSurfaces: string[];
		versionRequired: boolean;
		signals: string;
		checkpointCommands: string[];
		arbitraryCallbackCheckpoint: boolean;
		signalAndCheckpointNamesAreDistinct: boolean;
		ordinaryJobCheckpointStorage: boolean;
		compatibility: string;
		incompatibleReplay: string;
		cronOwner: string;
		cronTickIdentity: string;
		scheduleRemoval: string;
	}>;
	clientBoundary: Readonly<Record<string, string>>;
	workflowAuthority: Readonly<{
		projection: string[];
		benignExemptions: Array<Readonly<{ path: string; reason: string }>>;
	}>;
	rejectedAlternatives: string[];
}>;

type ModelState = Readonly<{
	scheduleActive: boolean;
	tickIdentity: string | null;
	run: string;
	attempt: number;
	lease: string | null;
	version: number;
	executable: string;
	commandDigest: string;
	steps: Readonly<Record<string, string>>;
	signal: string | null;
	effectIdentity: string | null;
	history: string[];
	last: Readonly<{ ok: boolean; message: string }>;
}>;

type JobMachine = Readonly<{
	initial(): ModelState;
	reduce(state: ModelState, action: Readonly<{ type: string }>): ModelState;
}>;

const REQUIRED_ACTION_OWNERSHIP = [
	"one external or nondeterministic invocation",
	"input and inferred output with optional output pin",
	"declared errors",
	"Policy and network exposure",
	"cancellation and explicit ambiguity",
] as const;

const REQUIRED_ACTION_CONTEXT = [
	"immutable Execution facts",
	"external-effect Services",
	"generated Query callers",
	"generated Mutation callers",
] as const;

const REQUIRED_FORBIDDEN_ACTION_CONTEXT = [
	"data or transaction facade",
	"raw database",
	"durable run or checkpoint control",
	"System elevation",
] as const;

const REQUIRED_JOB_ABSENCES = [
	"Workflow Resource",
	"defineWorkflow",
	"Workflow client",
	"second workflow runtime",
] as const;

const REQUIRED_CHECKPOINT_COMMANDS = [
	"named generated Mutation",
	"named generated Action",
	"durable sleep",
	"typed signal wait",
] as const;

const REQUIRED_REJECTIONS = [
	"separate Workflow Resource over the same durable kernel",
	"Job mode switch or builder that creates a second Definition shape",
	"generic step.run callback",
	"core Auth product",
	"separate cron or scheduler Resource",
] as const;

const REPOSITORY_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../../..",
);

const WORKFLOW_WORD = /\bworkflows?\b/i;
const WORKFLOW_PRODUCT_MARKERS = [
	/defineWorkflow/,
	/\bDurable Workflow\b/,
	/\bWorkflow (?:Resource|Checkpoint|client|history|attempt|step|product|authoring|semantics|commands|integration|breadth|publication|evolution)\b/,
	/\bJob\/Workflow\b/,
	/\bJob, Reaction, and Workflow\b/,
	/\bWorkflows\b/,
] as const;

const REQUIRED_WORKFLOW_PROJECTION = [
	"CONTEXT.md",
	"HANDOFF.md",
	"SPEC.md",
	"apps/docs/content/docs/v4/beta1-release.mdx",
	"apps/docs/content/docs/v4/durable-reactions.mdx",
	"docs/adr/0003-studio-is-the-operational-application-surface.md",
	"docs/adr/0004-prove-one-tracer-before-capability-breadth.md",
	"docs/adr/0009-bind-executable-definitions-from-the-current-app-contract.md",
	"docs/adr/0013-freeze-transactional-dispatch-and-reaction.md",
	"docs/adr/0014-freeze-runtime-client-envelope-and-minimal-studio.md",
	"docs/adr/0016-freeze-lifecycle-jobs-and-shared-durable-kernel.md",
	"docs/adr/0019-freeze-semantic-kernels-and-public-surface.md",
	"docs/adr/0021-slice-the-beta-one-release.md",
	"docs/adr/0022-freeze-api-ergonomics-and-operation-projection.md",
	"docs/adr/README.md",
	"docs/v4/beta1-build-spec.md",
	"docs/v4/definition-composition.md",
	"docs/v4/design-fiction/COVERAGE.md",
	"docs/v4/design-fiction/authorize-with-policy.md",
	"docs/v4/design-fiction/durable-work.md",
	"docs/v4/design-fiction/index.md",
	"docs/v4/design-fiction/limits-and-guarantees.md",
	"docs/v4/design-fiction/routes-actions-and-integrations.md",
	"docs/v4/design-fiction/run-and-deploy.md",
	"docs/v4/design-fiction/studio-and-debugging.md",
	"docs/v4/documentation-plan.md",
	"docs/v4/executable-definition-compiler.md",
	"docs/v4/implementation-gates.md",
	"docs/v4/lifecycle-jobs-and-shared-durable-kernel.md",
	"docs/v4/multi-instance-and-optional-acceleration.md",
	"docs/v4/product-area-matrix.md",
	"docs/v4/prototypes/api-ergonomics-gate/CAPABILITY-MAP.md",
	"docs/v4/query-mutation-and-lifecycle.md",
	"docs/v4/questpie-v4-vision-for-martin.md",
	"docs/v4/research/framework-api-atlas/DECISION-MAP.md",
	"docs/v4/research/framework-api-atlas/PROOF-MAP.md",
	"docs/v4/runtime-client-envelope-and-studio.md",
	"docs/v4/semantic-kernels-and-public-surface.md",
	"docs/v4/transactional-dispatch-and-reaction.md",
	"docs/v4/visuals/architecture.html",
] as const;

const REQUIRED_WORKFLOW_EXEMPTIONS = [
	"apps/docs/content/docs/v4/index.mdx",
	"docs/v4/data-model-and-query-grammar.md",
	"docs/v4/schema-lifecycle.md",
] as const;

function exactMembers(
	actual: string[],
	expected: readonly string[],
	label: string,
): void {
	if (
		actual.length !== expected.length ||
		expected.some((member) => !actual.includes(member))
	)
		throw new Error(`${label} is incomplete`);
}

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
		...listFiles("docs/v4/design-fiction", ".md"),
		"docs/v4/prototypes/api-ergonomics-gate/CAPABILITY-MAP.md",
		"docs/v4/research/framework-api-atlas/DECISION-MAP.md",
		"docs/v4/research/framework-api-atlas/PROOF-MAP.md",
		...listFiles("docs/v4/visuals", ".html"),
	];
}

function workflowProductMarker(path: string): string | undefined {
	const source = readFileSync(join(REPOSITORY_ROOT, path), "utf8");
	return WORKFLOW_PRODUCT_MARKERS.find((marker) => marker.test(source))?.source;
}

function hasWorkflowSurface(source: string): boolean {
	return WORKFLOW_WORD.test(source) || source.includes("defineWorkflow");
}

export function scanWorkflowAuthority(projection: Projection): string[] {
	const projected = new Set(projection.workflowAuthority.projection);
	const benign = new Set(
		projection.workflowAuthority.benignExemptions.map((item) => item.path),
	);
	for (const exemption of projection.workflowAuthority.benignExemptions) {
		const source = readFileSync(join(REPOSITORY_ROOT, exemption.path), "utf8");
		if (!exemption.reason || !hasWorkflowSurface(source))
			throw new Error(`invalid Workflow exemption: ${exemption.path}`);
		const marker = workflowProductMarker(exemption.path);
		if (marker)
			throw new Error(
				`benign Workflow exemption contains product marker in ${exemption.path}: ${marker}`,
			);
	}
	const paths = [...new Set(currentAuthorityFiles())]
		.filter((path) =>
			hasWorkflowSurface(readFileSync(join(REPOSITORY_ROOT, path), "utf8")),
		)
		.sort();
	const uncovered = paths.filter(
		(path) => !projected.has(path) && !benign.has(path),
	);
	if (uncovered.length)
		throw new Error(
			`Workflow-bearing current authority missing from projection: ${uncovered.join(", ")}`,
		);
	return paths;
}

export function validateProjection(projection: Projection): void {
	if (
		projection.version !== 1 ||
		projection.decision !== "unifyCheckpointedWorkIntoJob"
	)
		throw new Error("decision identity is invalid");

	const auth = projection.routeAuth;
	if (
		auth.authority !== "ADR-0015 and P6 remain the accepted prerequisite" ||
		auth.coreAuthProduct !== false ||
		auth.credentialOwner !==
			"application provider through one credential resolver" ||
		auth.principalOwner !== "credential resolver" ||
		auth.contextOwner !== "Context Resolution" ||
		auth.authorizationOwner !== "Policy" ||
		auth.referenceIntegration !==
			"Better Auth through ordinary Service, Route, Collection, and credential-resolver composition"
	)
		throw new Error("Route/Auth ownership drifted from ADR-0015/P6");

	exactMembers(
		projection.action.owns,
		REQUIRED_ACTION_OWNERSHIP,
		"Action ownership",
	);
	exactMembers(
		projection.action.context,
		REQUIRED_ACTION_CONTEXT,
		"Action context",
	);
	exactMembers(
		projection.action.forbiddenContext,
		REQUIRED_FORBIDDEN_ACTION_CONTEXT,
		"forbidden Action context",
	);
	if (
		projection.action.automaticRetry !== false ||
		projection.action.durableEffectIdentityOwner !==
			"Reaction or Job checkpoint" ||
		projection.action.effectIdentity.directInvocation !==
			"explicit caller metadata" ||
		projection.action.effectIdentity.checkpointInvocation !==
			"derived from Job run and ordered checkpoint name" ||
		projection.action.effectIdentity.handlerAccess !== "effect.id" ||
		projection.action.effectIdentity.authorOverride !== false ||
		projection.action.providerGuarantee !==
			"explicit idempotency and receipt contract; ambiguity remains when outcome cannot be proved"
	)
		throw new Error("Action retry or ambiguity ownership is invalid");

	exactMembers(
		projection.job.publicResources,
		["Job"],
		"public durable resources",
	);
	exactMembers(
		projection.job.absentPublicSurfaces,
		REQUIRED_JOB_ABSENCES,
		"removed Workflow surfaces",
	);
	exactMembers(
		projection.job.checkpointCommands,
		REQUIRED_CHECKPOINT_COMMANDS,
		"checkpoint command set",
	);
	if (
		projection.job.versionRequired !== true ||
		projection.job.signals !== "optional closed structural map" ||
		projection.job.arbitraryCallbackCheckpoint !== false ||
		projection.job.signalAndCheckpointNamesAreDistinct !== true ||
		projection.job.ordinaryJobCheckpointStorage !== false ||
		projection.job.compatibility !==
			"job identity, semantic version, executable digest, ordered checkpoint name, and canonical command digest" ||
		projection.job.incompatibleReplay !== "refuse claim" ||
		projection.job.cronOwner !==
			"compiler-owned schedule attached to Job over PostgreSQL durable state" ||
		projection.job.cronTickIdentity !==
			"one stable identity per scheduled instant" ||
		projection.job.scheduleRemoval !==
			"stop future ticks and preserve accepted runs"
	)
		throw new Error("Job, checkpoint, or cron ownership is invalid");

	if (
		projection.clientBoundary.networkAction !== "generated client member" ||
		projection.clientBoundary.route !== "no generated semantic client" ||
		projection.clientBoundary.job !== "no generic browser control plane"
	)
		throw new Error("client boundary is invalid");

	const workflowPaths = scanWorkflowAuthority(projection);
	exactMembers(
		projection.workflowAuthority.projection,
		REQUIRED_WORKFLOW_PROJECTION,
		"Workflow authority projection",
	);
	exactMembers(
		projection.workflowAuthority.benignExemptions.map((item) => item.path),
		REQUIRED_WORKFLOW_EXEMPTIONS,
		"benign Workflow exemptions",
	);
	if (
		workflowPaths.length !==
		projection.workflowAuthority.projection.length +
			projection.workflowAuthority.benignExemptions.length
	)
		throw new Error("Workflow authority classification is not exact");
	exactMembers(
		projection.rejectedAlternatives,
		REQUIRED_REJECTIONS,
		"rejected alternatives",
	);
}

function loadMachine(): JobMachine {
	const html = readFileSync(
		new URL("./checkpointed-job-prototype.html", import.meta.url),
		"utf8",
	);
	const match = html.match(
		/\/\/ PROOF-MODEL-START\s*([\s\S]*?)\s*\/\/ PROOF-MODEL-END/,
	);
	if (!match?.[1]) throw new Error("browser prototype proof model is missing");
	return runInNewContext(`${match[1]}\nJobMachine`) as JobMachine;
}

function execute(machine: JobMachine, actions: readonly string[]): ModelState {
	return actions.reduce(
		(state, type) => machine.reduce(state, { type }),
		machine.initial(),
	);
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

export function validateModel(): void {
	const machine = loadMachine();
	const ordinary = execute(machine, [
		"accept-manual",
		"claim",
		"complete-ordinary",
	]);
	assert(ordinary.run === "succeeded", "ordinary Job did not succeed");
	assert(ordinary.attempt === 1, "ordinary Job used more than one attempt");
	assert(
		Object.keys(ordinary.steps).length === 0,
		"ordinary Job created checkpoint history",
	);

	const resumed = execute(machine, [
		"accept-manual",
		"claim",
		"mutation-step",
		"crash",
		"claim",
		"mutation-step",
		"succeed",
	]);
	assert(resumed.run === "succeeded", "crashed Job did not resume");
	assert(resumed.attempt === 2, "crashed Job did not create a fresh attempt");
	assert(resumed.steps.review === "complete", "Mutation checkpoint was lost");
	assert(
		resumed.history.filter((item) =>
			item.startsWith("Named Mutation checkpoint committed"),
		).length === 1,
		"Mutation checkpoint committed more than once",
	);
	assert(
		resumed.history.some((item) =>
			item.startsWith("Mutation checkpoint replayed"),
		),
		"stored Mutation checkpoint was not replayed",
	);

	const recovered = execute(machine, [
		"accept-manual",
		"claim",
		"mutation-step",
		"wait-signal",
		"signal",
		"claim",
		"action-ambiguous",
		"claim",
		"recover-action",
		"succeed",
	]);
	assert(recovered.run === "succeeded", "signal/Action Job did not succeed");
	assert(
		recovered.steps.approval === "complete",
		"typed signal was not stored",
	);
	assert(
		recovered.steps.publish === "complete",
		"Action receipt was not recovered",
	);
	assert(
		recovered.effectIdentity === "job-run-1/step:publish",
		"Action checkpoint did not derive stable Effect Identity",
	);
	assert(
		recovered.history.some((item) => item.includes("outcome is ambiguous")),
		"unknown provider outcome was collapsed",
	);

	const cron = execute(machine, [
		"accept-tick",
		"accept-tick",
		"remove-schedule",
		"accept-tick",
		"claim",
		"complete-ordinary",
	]);
	assert(cron.run === "succeeded", "accepted cron run was not preserved");
	assert(cron.scheduleActive === false, "cron schedule was not removed");
	assert(
		cron.history.filter((item) => item.includes("scheduler accepted"))
			.length === 1,
		"cron tick was accepted more than once",
	);
	assert(
		cron.history.filter((item) => item.startsWith("Rejected:")).length === 2,
		"cron duplicate or removed-schedule rejection is missing",
	);

	const incompatible = execute(machine, [
		"accept-manual",
		"claim",
		"mutation-step",
		"crash",
		"change-command",
		"claim-incompatible",
	]);
	assert(incompatible.run === "ready", "incompatible Job was claimed");
	assert(incompatible.last.ok === false, "incompatible replay was not refused");
	assert(
		incompatible.last.message.includes("digest changed"),
		"incompatible replay did not name the changed digest",
	);

	const incompatibleVersion = execute(machine, [
		"accept-manual",
		"claim",
		"mutation-step",
		"crash",
		"change-executable",
		"claim-incompatible",
		"change-version",
		"claim-incompatible",
	]);
	assert(incompatibleVersion.run === "ready", "incompatible Job was claimed");
	assert(incompatibleVersion.version === 2, "semantic version did not change");
	assert(
		incompatibleVersion.history.some((item) =>
			item.includes("executable bytes are unavailable"),
		),
		"missing compatible executable was not refused independently",
	);
	assert(
		incompatibleVersion.last.message.includes("semantic version changed"),
		"changed semantic version was not refused independently",
	);
}

export function validateTypeSurface(): void {
	const source = readFileSync(
		new URL("./type-prototype.ts", import.meta.url),
		"utf8",
	);
	if (/\bdefineWorkflow\s*\(/.test(source))
		throw new Error("type surface still exposes defineWorkflow");
	if (/\.step\.run\s*\(/.test(source))
		throw new Error("type surface exposes an arbitrary callback checkpoint");
	for (const marker of [
		"run.step.mutation(",
		"run.step.action(",
		'run.step.waitForSignal("approval-gate", {',
		'signal: "approval"',
		"effectKey: effect.id",
		"@ts-expect-error The checkpoint derives Effect Identity",
		"@ts-expect-error Action owns no transaction/data facade.",
		"@ts-expect-error No signal name exists",
	])
		if (!source.includes(marker))
			throw new Error(`type proof marker is missing: ${marker}`);
}

export function validateAlternativeSurfaces(): void {
	const source = readFileSync(
		new URL("./alternatives-prototype.ts", import.meta.url),
		"utf8",
	);
	for (const marker of [
		"defineUnifiedJob",
		"defineSeparateJob",
		"defineSeparateWorkflow",
		"defineModeJob",
		"resourceKinds: 2",
		"definitionShapes: 2",
		"promotion changes the Definition shape",
	])
		if (!source.includes(marker))
			throw new Error(`alternative-surface marker is missing: ${marker}`);
}

if (import.meta.main) {
	const projection = JSON.parse(
		readFileSync(new URL("./PROJECTION.json", import.meta.url), "utf8"),
	) as Projection;
	validateProjection(projection);
	validateModel();
	validateTypeSurface();
	validateAlternativeSurfaces();
	const workflowPaths = scanWorkflowAuthority(projection);
	console.log(
		`BETA.2 execution breadth: Action + one Job/cron/checkpoint contract is coherent across three compiled interfaces, six executable model scenarios, and ${workflowPaths.length} classified Workflow-bearing authority files`,
	);
}
