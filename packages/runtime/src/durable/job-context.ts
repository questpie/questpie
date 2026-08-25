type JobExecutionFacts = Readonly<{
	principal: unknown;
	authority: unknown;
	tenant: unknown;
	values: unknown;
	signal: AbortSignal;
	deadline: number | null;
}>;

/** Projects the exact ordinary Execution facts available to a Job attempt. */
export function createDurableJobContext<
	Execution extends JobExecutionFacts,
	Run,
	Attempt,
>(
	execution: Execution,
	run: Run,
	attempt: Attempt,
): Readonly<
	Pick<
		Execution,
		"principal" | "authority" | "tenant" | "values" | "signal" | "deadline"
	> &
		Readonly<{ run: Run; attempt: Attempt }>
> {
	return Object.freeze({
		principal: execution.principal,
		authority: execution.authority,
		tenant: execution.tenant,
		values: execution.values,
		signal: execution.signal,
		deadline: execution.deadline,
		run,
		attempt,
	});
}
