import { widget } from "#questpie/admin/client/builder/widget/widget.js";

export default widget("table", {
	component: () =>
		import("#questpie/admin/client/components/widgets/table-widget.js"),
});
