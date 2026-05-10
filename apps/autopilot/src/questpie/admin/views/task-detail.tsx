import { view } from "@questpie/admin/client";
import { adminClientModule } from "@questpie/admin/client/modules/admin";

const collectionFormComponent = (adminClientModule.views as any)[
	"collection-form"
].component;

export default view("task-detail", {
	kind: "form",
	component: collectionFormComponent,
});
