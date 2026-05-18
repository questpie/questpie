import { view } from "@questpie/admin/client";

export default view("files-view", {
	kind: "list",
	component: () =>
		import("../components/files-view-component.js") as Promise<{
			default: React.ComponentType<any>;
		}>,
});
