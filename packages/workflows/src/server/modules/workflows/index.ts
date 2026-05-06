import { workflowsPlugin } from "../../plugin.js";
import generatedModule from "./.generated/module.js";

export * from "./.generated/module.js";

export const workflowsModule = {
	...generatedModule,
	plugin: workflowsPlugin(),
} as typeof generatedModule & { plugin: ReturnType<typeof workflowsPlugin> };

export default workflowsModule;
