import { widget } from "#questpie/admin/client/builder/widget/widget.js";

export default widget("stats", {
	component: () =>
		import("#questpie/admin/client/components/widgets/stats-widget.js"),
});
