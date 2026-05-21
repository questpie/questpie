export type AppCollections = Questpie.AppContext["collections"];

export type WorkflowContextCollections = Pick<
	Questpie.WorkflowContext,
	"collections"
>;

export type WorkflowServiceContext = Pick<
	Questpie.WorkflowContext,
	"collections" | "workflows"
>;
