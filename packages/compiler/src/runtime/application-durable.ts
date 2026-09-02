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
	const durableAttemptPostgres = createPostgresDatabaseDurableAttemptObservation({ database });
	const durableKernel = createPostgresDatabaseDurableKernel({
		database,
		attemptDatabase: durableAttemptPostgres.database,
		application: durableApplication,
		reactions: mutationArtifacts.reactions,
		jobs: mutationArtifacts.jobs,
	});
	const durableLedger = createPostgresDatabaseDurableEffectLedger({ database, attemptDatabase: durableAttemptPostgres.database, application: durableApplication });
	const durableMaintenance = createPostgresDatabaseDurablePrincipalMaintenance({
		database,
		application: durableApplication,
		authorize: input.maintenance.authorize,
	});
	const durableExecute = (request, { execution, queryObservation, ...operations }) => {
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
								observation: queryObservation,
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
	};
	const durableAttemptExecution = (request, work) => {
		let entered = false;
		return runtime.workerExecution(
			{ principal: durablePrincipal(request.principal), context: request.contextInput, signal: request.signal },
			(observation, proceed) => runObservedDurableAttempt({
				observation,
				request,
				use: () => durableAttemptPostgres.run({
					observation,
					principalKind: request.principal.kind,
					signal: request.signal,
					use: async () => {
						work.enter();
						if (work.preparationError !== undefined) return work.failure(work.preparationError);
						try {
							return await proceed();
						} catch (error) {
							if (entered) throw error;
							return work.failure(error);
						}
					},
				}),
			}),
			({ execution: { actionScope, ...execution }, ...operations }) => {
				entered = true;
				const queryObservation = executionObservationOf(actionScope)?.execution ?? null;
				return work.use(Object.freeze({ execution, queryObservation, ...operations }));
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
			attemptExecution: durableAttemptExecution,
			execute: durableExecute,
		});
		durableWorkers.add(worker);
		return worker;
	};`;
}
