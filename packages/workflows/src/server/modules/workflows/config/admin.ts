import { adminConfig } from "@questpie/admin/factories";

type WorkflowsAdminConfig = {
	readonly sidebar: unknown;
	readonly dashboard: unknown;
};

const workflowsAdminConfig = adminConfig({
	sidebar: { sections: [], items: [] },
	dashboard: { sections: [], items: [] },
}) as WorkflowsAdminConfig;

export default workflowsAdminConfig;
