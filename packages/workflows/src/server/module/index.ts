import { module } from "questpie";
import wfEvent from "./collections/wf-event.js";
import wfInstance from "./collections/wf-instance.js";
import wfLog from "./collections/wf-log.js";
import wfStep from "./collections/wf-step.js";
import wfExecute from "./jobs/wf-execute.js";
import wfMaintenance from "./jobs/wf-maintenance.js";
import wfResume from "./jobs/wf-resume.js";

/**
 * Workflows module — provides system collections and internal jobs
 * for durable workflow orchestration.
 *
 * Include this module in your app's modules array:
 * ```ts
 * import { workflowsModule } from "@questpie/workflows";
 *
 * const app = createApp({
 *   modules: [workflowsModule],
 *   // ...
 * });
 * ```
 */
const _module = module({
	name: "questpie-workflows" as const,

	collections: {
		wf_instance: wfInstance,
		wf_step: wfStep,
		wf_event: wfEvent,
		wf_log: wfLog,
	},

	jobs: {
		"wf-execute": wfExecute,
		"wf-resume": wfResume,
		"wf-maintenance": wfMaintenance,
	},
});

export type WorkflowsModule = typeof _module;
export default _module;
