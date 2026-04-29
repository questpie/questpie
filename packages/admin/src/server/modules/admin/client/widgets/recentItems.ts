import { widget } from "#questpie/admin/client/builder/widget/widget.js";

export default widget("recentItems", {
	component: () =>
		import("#questpie/admin/client/components/widgets/recent-items-widget.js"),
});
