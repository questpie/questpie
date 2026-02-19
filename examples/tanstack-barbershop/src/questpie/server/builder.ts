import { adminModule, auditModule } from "@questpie/admin/server";
import { q } from "questpie";

export const qb = q.use(adminModule).use(auditModule);
