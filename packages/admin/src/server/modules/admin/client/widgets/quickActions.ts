import { widget } from "#questpie/admin/client/builder/widget/widget.js";

export default widget("quickActions", {
	component: () =>
		import("#questpie/admin/client/components/widgets/quick-actions-widget.js"),
});
