import { view } from "#questpie/admin/client/builder/view/view.js";

export default view("collection-table", {
	kind: "list",
	component: () =>
		import("#questpie/admin/client/views/collection/table-view.js") as Promise<{
			default: React.ComponentType<any>;
		}>,
});
