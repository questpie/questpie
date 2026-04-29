import { widget } from "#questpie/admin/client/builder/widget/widget.js";

export default widget("progress", {
	component: () =>
		import("#questpie/admin/client/components/widgets/progress-widget.js"),
});
