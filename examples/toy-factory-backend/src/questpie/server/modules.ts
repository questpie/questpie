/**
 * Modules — static module dependencies for this project.
 */
import { adminModule } from "@questpie/admin/server";
import { openApiModule } from "@questpie/openapi";
import { workflowsModule } from "@questpie/workflows/server";

const modules = [adminModule, openApiModule, workflowsModule] as const;

export default modules;
