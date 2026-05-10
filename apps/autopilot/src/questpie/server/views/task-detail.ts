import type { FormViewConfig, ViewDefinition } from "@questpie/admin/factories";
import { view } from "@questpie/admin/factories";

export type TaskDetailViewConfig = FormViewConfig & {
	timeline?: boolean;
	relatedTasks?: boolean;
	artifacts?: boolean;
};

export default view<TaskDetailViewConfig>("task-detail", {
	kind: "form",
}) as ViewDefinition<"task-detail", "form", TaskDetailViewConfig>;
