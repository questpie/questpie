/** Renders the structural Query projection shared by direct, Fetch, and watch Executions. */
export function renderDatabaseQueryProject(): string {
	return `project: (scope) => {
				const facts = scope.facts;
				const queryObservation = executionObservationOf(scope)?.execution ?? null;
				return Object.freeze({
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
									authority: facts.authority,
									principal: { id: facts.principal.id, kind: facts.principal.kind },
									tenant: { id: facts.tenant.id },
								},
								database,
								observation: queryObservation,
								signal: facts.signal,
								observer: facts.liveQueryObservation ?? undefined,
							});
						},
					}),
					signal: facts.signal,
				});
			},`;
}
