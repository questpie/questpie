import adminClientModule from "@questpie/admin/client-module";
import { workflowsClientModule } from "@questpie/workflows/client/modules/workflows";
export default {
	name: "app-admin" as const,
	views: { ...adminClientModule.views, ...workflowsClientModule.views },
	components: {
		...adminClientModule.components,
		...workflowsClientModule.components,
	},
	fields: { ...adminClientModule.fields, ...workflowsClientModule.fields },
	pages: { ...adminClientModule.pages, ...workflowsClientModule.pages },
	widgets: { ...adminClientModule.widgets, ...workflowsClientModule.widgets },
	blocks: { ...adminClientModule.blocks, ...workflowsClientModule.blocks },
};
