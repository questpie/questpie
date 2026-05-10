import { view } from "#questpie/admin/client/builder/view/view.js";

export default view("list-view", {
	kind: "list",
	component: () =>
		import("#questpie/admin/client/views/collection/list-view.js") as Promise<{
			default: React.ComponentType<any>;
		}>,
});
