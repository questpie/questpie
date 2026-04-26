/**
 * Visual Edit Workspace view — opt-in alternative to the default
 * `collection-form`. Mirrors the same `FormViewConfig` contract so
 * collections can swap between the two via the `view` key:
 *
 * ```ts
 * .form(({ v }) => v.visualEditForm({ ... }))
 * ```
 *
 * The client-side React component lives in
 * `packages/admin/src/server/modules/admin/client/views/visual-edit-form.ts`.
 */
import type {
	FormViewConfig,
	ViewDefinition,
} from "#questpie/admin/server/augmentation.js";
import { view } from "#questpie/admin/server/registry-helpers.js";

export default view<FormViewConfig>("visual-edit-form", {
	kind: "form",
}) as ViewDefinition<"visual-edit-form", "form", FormViewConfig>;
