type ReactionExecutionFacts = Readonly<{
	principal: unknown;
	authority: unknown;
	tenant: unknown;
	values: unknown;
	signal: AbortSignal;
	deadline: number | null;
}>;

type ReactionCapabilities = Readonly<{
	data: unknown;
	queries: unknown;
	mutations: unknown;
}>;

/** Projects only the declared Execution facts and operations for a Reaction. */
export function createDurableReactionContext<
	Execution extends ReactionExecutionFacts,
	Capabilities extends ReactionCapabilities,
	Run,
	Attempt,
>(
	execution: Execution,
	capabilities: Capabilities,
	run: Run,
	attempt: Attempt,
): Readonly<
	Pick<
		Execution,
		"principal" | "authority" | "tenant" | "values" | "signal" | "deadline"
	> &
		Pick<Capabilities, "data" | "queries" | "mutations"> &
		Readonly<{ run: Run; attempt: Attempt }>
> {
	return Object.freeze({
		principal: execution.principal,
		authority: execution.authority,
		tenant: execution.tenant,
		values: execution.values,
		signal: execution.signal,
		deadline: execution.deadline,
		data: capabilities.data,
		queries: capabilities.queries,
		mutations: capabilities.mutations,
		run,
		attempt,
	});
}
