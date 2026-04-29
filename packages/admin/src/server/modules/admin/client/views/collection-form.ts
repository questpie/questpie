import { view } from "#questpie/admin/client/builder/view/view.js";

export default view("collection-form", {
	kind: "form",
	component: () =>
		import("#questpie/admin/client/views/collection/form-view.js") as Promise<{
			default: React.ComponentType<any>;
		}>,
});
