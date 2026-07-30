import { view } from "#questpie/admin/server/registry-helpers.js";

/**
 * Table view — the default list view for collections.
 */
import type {
	ListViewConfig,
	ViewDefinition,
} from "../../../augmentation/index.js";

export default view<ListViewConfig>("collection-table", {
	kind: "list",
}) as ViewDefinition<"collection-table", "list", ListViewConfig>;
