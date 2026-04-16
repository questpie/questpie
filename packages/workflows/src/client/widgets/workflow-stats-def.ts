import { widget } from "@questpie/admin/client";

export default widget("workflow-stats", {
	component: () => import("./workflow-stats-widget.js"),
});
