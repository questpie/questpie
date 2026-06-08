import type { FormViewConfig, ViewDefinition } from "@questpie/admin/factories";
import { view } from "@questpie/admin/factories";

export type FileDetailViewConfig = FormViewConfig & {
	preview?: boolean;
	provenance?: boolean;
	relatedResources?: boolean;
};

export default view<FileDetailViewConfig>("file-detail", {
	kind: "form",
}) as ViewDefinition<"file-detail", "form", FileDetailViewConfig>;
