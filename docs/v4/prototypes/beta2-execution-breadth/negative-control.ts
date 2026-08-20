import { scanWorkflowAuthority, validateProjection } from "./check";
import projectionSource from "./PROJECTION.json";

type MutableProjection = typeof projectionSource;

const clone = (): MutableProjection => structuredClone(projectionSource);

const invalid: Array<readonly [string, (value: MutableProjection) => void]> = [
	[
		"core Auth product",
		(value) => {
			value.routeAuth.coreAuthProduct = true;
		},
	],
	[
		"automatic Action retry",
		(value) => {
			value.action.automaticRetry = true;
		},
	],
	[
		"author-controlled checkpoint Effect Identity",
		(value) => {
			value.action.effectIdentity.authorOverride = true;
		},
	],
	[
		"Action transaction access",
		(value) => {
			value.action.forbiddenContext = value.action.forbiddenContext.filter(
				(item) => item !== "data or transaction facade",
			);
		},
	],
	[
		"public Workflow",
		(value) => {
			value.job.checkpointOrchestrationResources.push("Workflow");
		},
	],
	[
		"defineWorkflow compatibility alias",
		(value) => {
			value.job.absentPublicSurfaces = value.job.absentPublicSurfaces.filter(
				(item) => item !== "defineWorkflow",
			);
		},
	],
	[
		"arbitrary checkpoint callback",
		(value) => {
			value.job.arbitraryCallbackCheckpoint = true;
		},
	],
	[
		"signal name doubles as checkpoint identity",
		(value) => {
			value.job.signalAndCheckpointNamesAreDistinct = false;
		},
	],
	[
		"ordinary Job checkpoint storage",
		(value) => {
			value.job.ordinaryJobCheckpointStorage = true;
		},
	],
	[
		"latest-code replay",
		(value) => {
			value.job.incompatibleReplay = "run latest code";
		},
	],
	[
		"schedule removal cancels work",
		(value) => {
			value.job.scheduleRemoval = "cancel accepted runs";
		},
	],
];

for (const [name, mutate] of invalid) {
	const value = clone();
	mutate(value);
	let rejected = false;
	try {
		validateProjection(value);
	} catch {
		rejected = true;
	}
	if (!rejected) throw new Error(`negative control was accepted: ${name}`);
}

const omittedAuthority = clone();
const omittedPath = "apps/docs/content/docs/v4/beta1-release.mdx";
omittedAuthority.workflowAuthority.projection =
	omittedAuthority.workflowAuthority.projection.filter(
		(path) => path !== omittedPath,
	);
let omissionNamed = false;
try {
	scanWorkflowAuthority(omittedAuthority);
} catch (error) {
	omissionNamed = error instanceof Error && error.message.includes(omittedPath);
}
if (!omissionNamed)
	throw new Error("repository scan accepted or hid omitted Workflow authority");

const falseBenign = clone();
const productPath =
	"docs/adr/0016-freeze-lifecycle-jobs-and-shared-durable-kernel.md";
falseBenign.workflowAuthority.projection =
	falseBenign.workflowAuthority.projection.filter(
		(path) => path !== productPath,
	);
falseBenign.workflowAuthority.benignExemptions.push({
	path: productPath,
	reason: "invalid attempt to hide product authority",
});
let productMarkerNamed = false;
try {
	scanWorkflowAuthority(falseBenign);
} catch (error) {
	productMarkerNamed =
		error instanceof Error &&
		error.message.includes(productPath) &&
		error.message.includes("product marker");
}
if (!productMarkerNamed)
	throw new Error(
		"repository scan accepted a product-bearing benign exemption",
	);

const falseHistorical = clone();
const currentResearchPath =
	"docs/v4/research/production-backend/DECISION-MAP.md";
falseHistorical.workflowAuthority.projection =
	falseHistorical.workflowAuthority.projection.filter(
		(path) => path !== currentResearchPath,
	);
falseHistorical.workflowAuthority.historicalEvidenceExemptions.push({
	path: currentResearchPath,
	reason: "invalid attempt to hide the current owner-directed decision map",
});
let historicalHeaderRejected = false;
try {
	scanWorkflowAuthority(falseHistorical);
} catch (error) {
	historicalHeaderRejected =
		error instanceof Error &&
		error.message.includes(currentResearchPath) &&
		error.message.includes("evidence-only header");
}
if (!historicalHeaderRejected)
	throw new Error("repository scan accepted a hand-added historical exclusion");

console.log(
	`Negative controls: ${invalid.length + 3} invalid contracts and authority classifications rejected`,
);
