import { view } from "@questpie/admin/client";

export default view("knowledge-detail", {
	kind: "form",
	component: () =>
		import("../components/knowledge-detail-component.js") as Promise<{
			default: React.ComponentType<any>;
		}>,
});
