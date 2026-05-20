import { view } from "@questpie/admin/client";

export default view("task-detail", {
	kind: "form",
	component: () =>
		import("../components/task-detail-component.js") as Promise<{
			default: React.ComponentType<any>;
		}>,
});
