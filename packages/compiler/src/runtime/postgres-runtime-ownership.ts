export function renderPostgresRuntimeImports(): string {
	return `createLinkedPostgresContextBootstrapFactory,
		createPostgresDatabaseDurableEffectLedger,
		createPostgresDatabaseDurableKernel,
		createPostgresDatabaseDurablePrincipalMaintenance,
		createPostgresDatabaseMutationInvoker,
		createRuntimePostgres,
		definePostgresAdministrativeStatement,
		definePostgresStatement,
		executePostgresDatabaseQuery,
		verifyPostgresDatabaseReadinessPrerequisitesInOwnedTransaction`;
}

export function renderPostgresRuntimeOwnership(): string {
	return `const postgresRuntime = createRuntimePostgres({
		connectionUrl: input.postgres.connectionUrl,
		directConnectionUrl: input.postgres.directConnectionUrl,
		pool: {
			max: 10,
			connectTimeoutMs: 5_000,
			checkoutTimeoutMs: 5_000,
			idleTimeoutMs: 10_000,
			maxLifetimeSeconds: 300,
		},
		timeouts: {
			statementMs: 5_000,
			lockMs: 1_000,
			idleInTransactionMs: 5_000,
		},
	});
	const database = Object.freeze({ transaction: postgresRuntime.transaction });`;
}

export function renderPostgresRuntimeFacts(): string {
	return `[Symbol.for("questpie.internal.postgres-facts")]: () => postgresRuntime.facts(),`;
}
