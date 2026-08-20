import { readFileSync } from "node:fs";
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
		"@ts-expect-error Action owns no transaction/data facade.",
		"@ts-expect-error No signal name exists",
	])
		if (!source.includes(marker))
			throw new Error(`type proof marker is missing: ${marker}`);
}

if (import.meta.main) {
	const projection = JSON.parse(
		readFileSync(new URL("./PROJECTION.json", import.meta.url), "utf8"),
	) as Projection;
	validateProjection(projection);
	validateModel();
	validateTypeSurface();
	console.log(
		"BETA.2 execution breadth: Action + one Job/cron/checkpoint contract is coherent across projection, type surface, and five executable model scenarios",
	);
}
