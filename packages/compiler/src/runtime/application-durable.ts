/** Renders the shared Job/Reaction worker owner for a generated server. */
export function renderDurableWorkerOwner(
	input: Readonly<{
		application: string;
		directQueries: string;
		directMutations: string;
		checkpointMutations: string;
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
		runtimeBuildDigest: loaded.artifacts.runtimeBuild.digest,
		reactions: mutationArtifacts.reactions,
		jobs: mutationArtifacts.jobs,
	});
	const durableLedger = createPostgresDatabaseDurableEffectLedger({ database, attemptDatabase: durableAttemptPostgres.database, application: durableApplication });
	const durableMaintenance = createPostgresDatabaseDurablePrincipalMaintenance({
		database,
		application: durableApplication,
		authorize: input.maintenance.authorize,
	});
	const checkpointBindings = loaded.artifacts.operationContracts.operations
		.filter((contract) => contract.identity.startsWith("mutation:"))
		.map((contract) => {
			const slot = loaded.artifacts.runtimeExecutables.slots.find((slot) => slot.identity === contract.identity && slot.slot === "handler");
			if (!slot) throw new TypeError("Mutation checkpoint executable is unavailable");
			return Object.freeze({ identity: contract.identity, input: contract.input, output: contract.output, contractDigest: slot.contractDigest, runtimeGraphDigest: slot.runtimeGraphDigest });
		});
	const durableExecute = async (request, { execution, queryObservation, ...operations }) => {
		request.assertResolvedTenant(execution.tenant.id);
		if (request.capability === "job") {
			const binding = jobBindings.get(request.job.identity);
			if (!binding) throw new TypeError("Job executable is unavailable");
			const checkpoints = await createMutationCheckpointRun({
				store: createPostgresMutationCheckpointStore({ database, application: durableApplication, signal: request.signal }),
				claim: request.claim, signal: request.signal, bindings: checkpointBindings,
				invoke: (checkpointBinding, checkpointInput, reservation) => runtime.execution(
					{ principal: durablePrincipal(request.principal), context: request.contextInput, signal: request.signal },
					({ execution: fresh, invoke }) => {
						request.assertResolvedTenant(fresh.tenant.id);
						const call = { callId: reservation.callId, signal: request.signal };
						return invoke(checkpointBinding.identity, checkpointInput, reservation.state === "completed"
							? withRequiredMutationReceipt(call, { transactionId: reservation.receiptTransactionId, resultDigest: reservation.receiptResultDigest }) : call);
					},
				),
			});
			try { return await binding.execute({
				input: request.input,
				ctx: Object.freeze({ ...createDurableJobContext(execution, Object.freeze({ ...request.run, step: checkpoints.step }), request.attempt), mutations: ${input.checkpointMutations} }),
				errors: request.errors,
			}); } finally { await checkpoints.finish(); }
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
