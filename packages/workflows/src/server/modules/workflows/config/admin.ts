import { adminConfig } from "@questpie/admin/server";

import workflowsDashboardContribution from "../dashboard.js";
import workflowsSidebarContribution from "../sidebar.js";

type WorkflowsAdminConfig = {
	readonly sidebar: unknown;
	readonly dashboard: unknown;
};

const workflowsAdminConfig = adminConfig({
	sidebar: workflowsSidebarContribution,
	dashboard: workflowsDashboardContribution,
}) as WorkflowsAdminConfig;

export default workflowsAdminConfig;
