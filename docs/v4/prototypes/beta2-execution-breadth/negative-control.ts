import { validateProjection } from "./check";
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
			value.job.publicResources.push("Workflow");
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

console.log(`Negative controls: ${invalid.length} invalid contracts rejected`);
