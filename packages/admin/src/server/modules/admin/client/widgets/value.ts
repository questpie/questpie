import { widget } from "#questpie/admin/client/builder/widget/widget.js";

export default widget("value", {
	component: () =>
		import("#questpie/admin/client/components/widgets/value-widget.js"),
});
