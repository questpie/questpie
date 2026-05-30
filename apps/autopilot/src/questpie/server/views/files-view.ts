import type { ListViewConfig, ViewDefinition } from "@questpie/admin/factories";
import { view } from "@questpie/admin/factories";

export type FilesViewConfig = ListViewConfig & {
	pathField: string;
	nameField?: string;
	contentField?: string;
	contentTypeField?: string;
	kindField?: string;
	defaultLayout?: "grid" | "list";
	showPreview?: boolean;
};

export default view<FilesViewConfig>("files-view", {
	kind: "list",
}) as ViewDefinition<"files-view", "list", FilesViewConfig>;
