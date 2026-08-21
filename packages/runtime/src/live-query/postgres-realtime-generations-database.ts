import { sha256Digest } from "../canonical-json";
import type { PostgresDatabase } from "../postgres";
import {
	clearLatestGeneration,
	clearPriorAcknowledgement,
	insertGeneration,
	markGenerationEvaluated,
	pruneUnreferencedGenerations,
	readAcknowledgementCandidate,
	readGenerationBinding,
	setAcknowledgement,
	upsertObservedPlan,
} from "./postgres-realtime-generation-statements";
import type { PostgresRealtimeGenerationStore } from "./postgres-realtime-generations";
import {
	scopeLockIdentity,
	validBoundedIdentity,
	validateCompleteGeneration,
	validateGeneration,
	validateResumeToken,
	validateScope,
	validateScopeLease,
} from "./postgres-realtime-scope-contract";
import { lockScope } from "./postgres-realtime-scope-statements";

const readWrite = Object.freeze({
	isolation: "readCommitted" as const,
	access: "readWrite" as const,
});

export function createPostgresRealtimeGenerationDatabaseStore(
	database: PostgresDatabase,
): PostgresRealtimeGenerationStore {
	return Object.freeze({
		async stageGeneration(staged) {
			validateScopeLease(staged);
			validBoundedIdentity(staged.bindingIdentity, "binding identity");
			validateCompleteGeneration(staged);
			return database.transaction({
				mode: readWrite,
				async use(transaction) {
					await transaction.execute(lockScope, scopeLockIdentity(staged));
					const binding = await transaction.execute(
						readGenerationBinding,
						staged,
					);
					if (
						!binding ||
						staged.observedInvalidationGeneration <=
							binding.evaluatedInvalidationGeneration ||
						staged.observedInvalidationGeneration >
							binding.invalidationGeneration ||
						(binding.latestGeneration !== 0n &&
							staged.generation !== binding.latestGeneration + 1n)
					)
						return false;
					const identity = {
						applicationName: staged.applicationName,
						scopeIdentity: staged.scopeIdentity,
						bindingIdentity: staged.bindingIdentity,
						generation: staged.generation,
					};
					await transaction.execute(clearLatestGeneration, identity);
					const insert = {
						staged,
						binding,
						tokenDigest: sha256Digest(staged.resumeToken),
						planDigest: sha256Digest(staged.dependencyPlanBytes),
					};
					await transaction.execute(insertGeneration, insert);
					await transaction.execute(upsertObservedPlan, insert);
					await transaction.execute(markGenerationEvaluated, staged);
					await transaction.execute(pruneUnreferencedGenerations, identity);
					return true;
				},
			});
		},
		async acknowledgeWatch(acknowledgement) {
			validateScope(acknowledgement);
			validBoundedIdentity(acknowledgement.bindingIdentity, "binding identity");
			validateGeneration(acknowledgement.generation);
			const candidate = {
				...acknowledgement,
				tokenDigest: sha256Digest(
					validateResumeToken(acknowledgement.resumeToken),
				),
			};
			return database.transaction({
				mode: readWrite,
				async use(transaction) {
					await transaction.execute(
						lockScope,
						scopeLockIdentity(acknowledgement),
					);
					if (
						!(await transaction.execute(
							readAcknowledgementCandidate,
							candidate,
						))
					)
						return false;
					await transaction.execute(clearPriorAcknowledgement, acknowledgement);
					await transaction.execute(setAcknowledgement, acknowledgement);
					await transaction.execute(
						pruneUnreferencedGenerations,
						acknowledgement,
					);
					return true;
				},
			});
		},
	});
}
