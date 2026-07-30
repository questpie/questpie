import { view } from "#questpie/admin/server/registry-helpers.js";

/**
 * Global form view — the default form view for globals.
 */
import type {
	FormViewConfig,
	ViewDefinition,
} from "../../../augmentation/index.js";

export default view<FormViewConfig>("global-form", {
	kind: "form",
}) as ViewDefinition<"global-form", "form", FormViewConfig>;
