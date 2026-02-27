/**
 * Modules — static module dependencies for this project.
 */
import { adminModule, auditModule } from "@questpie/admin/server";

export default [adminModule, auditModule] as const;
