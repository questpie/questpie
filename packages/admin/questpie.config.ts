/**
 * Package-level codegen config for the @questpie/admin package.
 *
 * Used by `questpie generate` to discover and generate
 * `.generated/module.ts` for each module in the package.
 *
 * This config is dev-only — only the generated `.generated/module.ts`
 * files are published with the npm package.
 */
import { packageConfig } from "questpie/cli";

import { adminPlugin } from "./src/server/plugin.js";

export default packageConfig({
	modulesDir: "src/server/modules",
	modulePrefix: "questpie",
	plugins: [adminPlugin()],
});
