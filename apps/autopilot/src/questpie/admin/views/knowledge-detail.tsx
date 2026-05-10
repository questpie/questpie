import { view } from "@questpie/admin/client";
import { adminClientModule } from "@questpie/admin/client/modules/admin";

const collectionFormComponent = (adminClientModule.views as any)[
	"collection-form"
].component;

export default view("knowledge-detail", {
	kind: "form",
	component: collectionFormComponent,
});
