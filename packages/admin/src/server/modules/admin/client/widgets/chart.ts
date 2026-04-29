import { widget } from "#questpie/admin/client/builder/widget/widget.js";

export default widget("chart", {
	component: () =>
		import("#questpie/admin/client/components/widgets/chart-widget.js"),
});
