import { adminModule } from "@questpie/admin/modules/admin";
import { collection } from "#questpie/factories";

export default collection("assets")
	.merge(adminModule.collections.assets)
	.set("admin", { hidden: true, audit: false });
