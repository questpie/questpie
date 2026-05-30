export type RunCompletion = {
	status?: "completed" | "failed" | "cancelled";
	summary?: string | null;
	error?: string | null;
	knowledgeResourceIds?: string[];
};
