// @questpie/workflows/client — client-side admin UI module

export type { WorkflowsClientModule } from "../client/.generated/module.js";
// Client module (pages + widgets)
export { default as workflowsClientModule } from "../client/.generated/module.js";
export { WorkflowDetailPage } from "../client/pages/workflow-detail-page.js";
// Page components (for direct use if needed)
export { WorkflowListPage } from "../client/pages/workflow-list-page.js";
export { WorkflowsPage } from "../client/pages/workflows-page.js";
