export { workflowsModule } from "../../server/modules/workflows/index.js";
// Named category types — re-exported so the app index can enumerate this
// module's contributors via `interface AppX extends WorkflowsX …` (pure static
// register, never a fold). Empty categories are `Record<never, never>`.
export type {
	WorkflowsBlocks,
	WorkflowsCollections,
	WorkflowsComponents,
	WorkflowsFieldTypes,
	WorkflowsGlobals,
	WorkflowsJobs,
	WorkflowsModule,
	WorkflowsRoutes,
	WorkflowsViews,
} from "../../server/modules/workflows/index.js";
