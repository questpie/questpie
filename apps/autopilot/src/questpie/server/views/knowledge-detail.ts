import type { FormViewConfig, ViewDefinition } from "@questpie/admin/factories";
import { view } from "@questpie/admin/factories";

export type KnowledgeDetailViewConfig = FormViewConfig & {
	preview?: boolean;
	provenance?: boolean;
	relatedResources?: boolean;
};

export default view<KnowledgeDetailViewConfig>("knowledge-detail", {
	kind: "form",
}) as ViewDefinition<"knowledge-detail", "form", KnowledgeDetailViewConfig>;
