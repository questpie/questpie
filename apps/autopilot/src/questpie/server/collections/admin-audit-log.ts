import { auditModule } from "@questpie/admin/modules/audit";
import { collection } from "#questpie/factories";

export default collection("admin_audit_log")
	.merge(auditModule.collections.admin_audit_log)
	.set("admin", { hidden: true, audit: false });
