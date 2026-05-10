/**
 * Modules — static module dependencies for this project.
 */
import { adminModule } from "@questpie/admin/modules/admin";
import { openApiModule } from "@questpie/openapi";
import { workflowsModule } from "@questpie/workflows/modules/workflows";
const modules = [adminModule, openApiModule, workflowsModule] as const;

export default modules;
