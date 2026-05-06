/**
 * Modules — static module dependencies for this project.
 */
import { adminModule } from "@questpie/admin/server";
import { openApiModule } from "@questpie/openapi";

const modules = [adminModule, openApiModule] as const;

export default modules;
