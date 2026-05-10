/**
 * List view — dense flex renderer for collection lists.
 */
import type {
	ListViewConfig,
	ViewDefinition,
} from "#questpie/admin/server/augmentation.js";
import { view } from "#questpie/admin/server/registry-helpers.js";

export default view<ListViewConfig>("list-view", {
	kind: "list",
}) as ViewDefinition<"list-view", "list", ListViewConfig>;
