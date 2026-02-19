import { adminModule, qa } from "@questpie/admin/client";
import type { App } from "@/questpie/server/app.js";

export const builder = qa<App>().use(adminModule);
