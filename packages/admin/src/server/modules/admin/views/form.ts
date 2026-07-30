import { view } from "#questpie/admin/server/registry-helpers.js";

/**
 * Form view — the default edit view for collections.
 */
import type {
	FormViewConfig,
	ViewDefinition,
} from "../../../augmentation/index.js";

export default view<FormViewConfig>("collection-form", {
	kind: "form",
}) as ViewDefinition<"collection-form", "form", FormViewConfig>;
