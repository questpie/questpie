/** Renders the shared Job/Reaction worker owner for a generated server. */
export function renderDurableWorkerOwner(
	input: Readonly<{
		application: string;
		directQueries: string;
		directMutations: string;
	}>,
): string {
	return `const reactionBindings = new Map(slotBindings
		.filter((binding) => binding.kind === "reaction")
		.map((binding) => [binding.identity, binding]));
	const jobBindings = new Map(slotBindings
		.filter((binding) => binding.kind === "job")
		.map((binding) => [binding.identity, binding]));
	const durableApplication = ${JSON.stringify(input.application)};
	const durableKernel = createPostgresDatabaseDurableKernel({
		database,
		application: durableApplication,
		reactions: mutationArtifacts.reactions,
		jobs: mutationArtifacts.jobs,
	});
	const durableLedger = createPostgresDatabaseDurableEffectLedger({ database, application: durableApplication });
	const durableMaintenance = createPostgresDatabaseDurablePrincipalMaintenance({
		database,
		application: durableApplication,
		authorize: input.maintenance.authorize,
	});
	const durableExecute = (request) => {
		return runtime.execution(
			{ principal: durablePrincipal(request.principal), context: request.contextInput, signal: request.signal },
			({ execution, ...operations }) => {
				request.assertResolvedTenant(execution.tenant.id);
				if (request.capability === "job") {
					const binding = jobBindings.get(request.job.identity);
					if (!binding) throw new TypeError("Job executable is unavailable");
					return binding.execute({
						input: request.input,
						ctx: createDurableJobContext(execution, request.run, request.attempt),
						errors: request.errors,
					});
				}
				const binding = reactionBindings.get(request.reaction.identity);
				if (!binding) throw new TypeError("Reaction executable is unavailable");
				return binding.execute({
					input: request.input,
					ctx: createDurableReactionContext(
						execution,
						Object.freeze({
							data: Object.freeze({
								run: (definition, operationInput) => {
									const queryDigest = structuralQueryDigests.get(definition);
									const linkedPlan = queryDigest && queryPlans?.get(queryDigest);
									if (!linkedPlan) throw new TypeError("Structural Query is not in the Runtime Build");
									return executePostgresDatabaseQuery({
										linkedPlan,
										binding: {
											templateDigest: linkedPlan.plan.templateDigest,
											values: linkedPlan.plan.binding.parameters.map(({ name }) => ({ parameter: name, value: operationInput[name] })),
										},
										executionFacts: {
											authority: execution.authority,
											principal: { id: execution.principal.id, kind: execution.principal.kind },
											tenant: { id: execution.tenant.id },
										},
										database,
										signal: execution.signal,
									});
								},
							}),
							queries: ${input.directQueries},
							mutations: ${input.directMutations},
						}),
						request.run,
						request.attempt,
					),
					errors: request.errors,
				});
			},
		);
	};
	const durableWorkers = new Set();
	const createWorker = (options) => {
		const worker = createDurableWorker({
			...options,
			kernel: durableKernel,
			ledger: durableLedger,
			reactions: mutationArtifacts.reactions,
			jobs: mutationArtifacts.jobs,
			execute: durableExecute,
		});
		durableWorkers.add(worker);
		return worker;
	};`;
}
