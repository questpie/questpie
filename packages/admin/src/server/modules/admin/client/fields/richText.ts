import { field } from "#questpie/admin/client/builder/field/field.js";
import { RichTextCell } from "#questpie/admin/client/views/collection/cells/primitive-cells.js";

export default field("richText", {
	component: () =>
		import("#questpie/admin/client/components/fields/rich-text-field.js").then(
			(m) => ({ default: m.RichTextField }),
		),
	cell: RichTextCell,
});
