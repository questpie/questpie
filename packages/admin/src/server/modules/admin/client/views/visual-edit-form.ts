import { view } from "#questpie/admin/client/builder/view/view.js";

/**
 * Visual Edit Workspace view — opt-in alternative to the default
 * `collection-form`. Activates a 2-pane layout with a preview
 * canvas on the left and a contextual inspector on the right.
 *
 * Enable per collection:
 *
 * ```ts
 * c.collection("pages")
 *   .admin()
 *   .preview({ url: ({ record }) => `/${record.slug}` })
 *   .form({ view: "visual-edit-form" })
 * ```
 */
export default view("visual-edit-form", {
	kind: "form",
	component: () =>
		import(
			"#questpie/admin/client/views/collection/visual-edit-form-view.js"
		) as Promise<{
			default: React.ComponentType<any>;
		}>,
});
