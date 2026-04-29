import { widget } from "#questpie/admin/client/builder/widget/widget.js";

export default widget("timeline", {
	component: () =>
		import("#questpie/admin/client/components/widgets/timeline-widget.js"),
});
