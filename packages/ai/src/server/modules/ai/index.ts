import generatedModule from "./.generated/module.js";

// Named category types — re-exported so the app index can enumerate this
// module's contributors via `interface AppX extends AiX …` (pure static
// register, never a fold). Empty categories are `Record<never, never>`.
export type {
  AiBlocks,
  AiCollections,
  AiComponents,
  AiFieldTypes,
  AiGlobals,
  AiJobs,
  AiModule,
  AiRoutes,
  AiServices,
  AiViews,
} from "./.generated/module.js";

export const aiModule = generatedModule;
