import { view } from "#questpie/admin/server/registry-helpers.js";

/**
 * List view — dense flex renderer for collection lists.
 */
import type {
	ListViewConfig,
	ViewDefinition,
} from "../../../augmentation/index.js";

export default view<ListViewConfig>("list-view", {
	kind: "list",
}) as ViewDefinition<"list-view", "list", ListViewConfig>;
