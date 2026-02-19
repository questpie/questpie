import type {
	CollectionVersioningOptions,
	WorkflowOptions,
	WorkflowStageOptions,
} from "#questpie/server/collection/builder/types.js";

export interface ResolvedWorkflowStage {
	name: string;
	label?: string;
	description?: string;
	transitions?: string[];
}

export interface ResolvedWorkflowConfig {
	enabled: boolean;
	initialStage: string;
	stages: ResolvedWorkflowStage[];
}

const DEFAULT_STAGES = ["draft", "published"] as const;

/**
 * Extract workflow option from versioning config.
 * Returns the workflow value (boolean | WorkflowOptions | undefined) from
 * the versioning option, handling both `boolean` and object forms.
 */
export function extractWorkflowFromVersioning(
	versioning: boolean | CollectionVersioningOptions | undefined,
): boolean | WorkflowOptions | undefined {
	if (!versioning || typeof versioning === "boolean") return undefined;
	return versioning.workflow;
}

export function resolveWorkflowConfig(
	workflow: boolean | WorkflowOptions | undefined,
): ResolvedWorkflowConfig | undefined {
	if (!workflow) {
		return undefined;
	}

	const workflowOptions = workflow === true ? {} : workflow;
	const rawStages = workflowOptions.stages;

	const stages = normalizeStages(rawStages);
	const initialStage = workflowOptions.initialStage ?? stages[0]?.name;

	if (!initialStage) {
		throw new Error("Workflow requires at least one stage");
	}

	if (!stages.some((stage) => stage.name === initialStage)) {
		throw new Error(
			`Workflow initialStage "${initialStage}" is not part of configured stages`,
		);
	}

	for (const stage of stages) {
		if (!stage.transitions) continue;

		for (const transition of stage.transitions) {
			if (!stages.some((target) => target.name === transition)) {
				throw new Error(
					`Workflow stage "${stage.name}" has unknown transition target "${transition}"`,
				);
			}
		}
	}

	return {
		enabled: true,
		initialStage,
		stages,
	};
}

function normalizeStages(
	stages: WorkflowOptions["stages"],
): ResolvedWorkflowStage[] {
	if (!stages) {
		return DEFAULT_STAGES.map((name) => ({ name }));
	}

	if (Array.isArray(stages)) {
		if (stages.length === 0) {
			throw new Error("Workflow stages array cannot be empty");
		}

		return dedupeAndValidate(
			stages.map((stageName) => ({ name: stageName.trim() })),
		);
	}

	const mappedStages = Object.entries(stages).map(([name, options]) => ({
		name: name.trim(),
		...normalizeStageOptions(options),
	}));

	if (mappedStages.length === 0) {
		throw new Error("Workflow stages config cannot be empty");
	}

	return dedupeAndValidate(mappedStages);
}

function normalizeStageOptions(
	options: WorkflowStageOptions | undefined,
): Omit<ResolvedWorkflowStage, "name"> {
	if (!options) {
		return {};
	}

	return {
		label: options.label,
		description: options.description,
		transitions: options.transitions
			? options.transitions.map((stage) => stage.trim())
			: undefined,
	};
}

function dedupeAndValidate(
	stages: ResolvedWorkflowStage[],
): ResolvedWorkflowStage[] {
	const seen = new Set<string>();

	for (const stage of stages) {
		if (!stage.name) {
			throw new Error("Workflow stage names cannot be empty");
		}

		if (seen.has(stage.name)) {
			throw new Error(`Workflow stage "${stage.name}" is duplicated`);
		}

		seen.add(stage.name);
	}

	return stages;
}
