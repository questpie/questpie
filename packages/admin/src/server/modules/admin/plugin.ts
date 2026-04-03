/**
 * Admin module plugin — re-exports the admin codegen plugin so that
 * module codegen discovers it and embeds it in the generated module
 * definition. This allows `extractPluginsFromModules` to pick it up
 * automatically at root-app codegen time.
 */
import { adminPlugin } from "../../plugin.js";

export default adminPlugin();
