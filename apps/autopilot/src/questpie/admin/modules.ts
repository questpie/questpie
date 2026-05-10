import { adminClientModule } from "@questpie/admin/client/modules/admin";
import { workflowsClientModule } from "@questpie/workflows/client/modules/workflows";

export default [adminClientModule, workflowsClientModule] as const;
