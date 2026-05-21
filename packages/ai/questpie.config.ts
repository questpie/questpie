import { adminPlugin } from "@questpie/admin/plugin";
import { packageConfig } from "questpie/cli";

import { aiPlugin } from "./src/server/plugin.js";

export default packageConfig({
	modulesDir: "src/server/modules",
	modulePrefix: "questpie",
	plugins: [adminPlugin(), aiPlugin()],
});
