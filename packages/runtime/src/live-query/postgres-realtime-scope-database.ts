import type { PostgresTransactionRunner } from "../postgres";
import type { PostgresRealtimeGenerationStore } from "./postgres-realtime-generations";
import {
	scopeLockIdentity,
	validBoundedIdentity,
	validDigest,
	validateApplicationIdentity,
	validateOpen,
	validateScope,
	validateScopeLease,
} from "./postgres-realtime-scope-contract";
import {
	allocateWatchSlot,
	attachScope,
	closeWatch,
	deleteExpiredPrincipalScopes,
	deleteExpiredScope,
	expireScopes,
	insertWatch,
	lockScope,
	markScopeOpen,
	readExistingWatch,
	readOpenWatch,
	readScopeAuthority,
	renewScope,
	scanOpenWatches,
	withdrawScope,
} from "./postgres-realtime-scope-statements";
import type { PostgresRealtimeScopeStore } from "./postgres-realtime-scope-store";

const readWrite = Object.freeze({
	isolation: "readCommitted" as const,
	access: "readWrite" as const,
});
const readOnly = Object.freeze({
	isolation: "readCommitted" as const,
	access: "readOnly" as const,
});
const unavailable = Object.freeze({ status: "unavailable" as const });
const limit = Object.freeze({ status: "limit" as const });

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
	return Buffer.from(left).equals(Buffer.from(right));
}

export function createPostgresRealtimeScopeDatabaseStore(
	input: Readonly<{
		database: PostgresTransactionRunner;
		generations: PostgresRealtimeGenerationStore;
	}>,
): PostgresRealtimeScopeStore {
	return Object.freeze({
		async attachScope(scope) {
			validateScope(scope);
			return input.database.transaction({
				mode: readWrite,
				async use(transaction) {
					await transaction.execute(deleteExpiredScope, scope);
					const holderGeneration = await transaction.execute(
						attachScope,
						scope,
					);
					return holderGeneration === undefined
						? unavailable
						: Object.freeze({ status: "attached" as const, holderGeneration });
				},
			});
		},
		async renewScope(scope) {
			validateScopeLease(scope);
			return input.database.transaction({
				mode: readWrite,
				use: (transaction) => transaction.execute(renewScope, scope),
			});
		},
		async openWatch(open) {
			validateOpen(open);
			return input.database.transaction({
				mode: readWrite,
				async use(transaction) {
					await transaction.execute(lockScope, scopeLockIdentity(open));
					await transaction.execute(deleteExpiredPrincipalScopes, open);
					const scope = await transaction.execute(readScopeAuthority, open);
					if (
						!scope ||
						(scope.authorityPartitionDigest !== null &&
							scope.authorityPartitionDigest !== open.authorityPartitionDigest)
					)
						return unavailable;
					const existing = await transaction.execute(readExistingWatch, open);
					if (existing) {
						if (
							existing.state === "open" &&
							existing.activeSlot !== null &&
							existing.authorityPartitionDigest ===
								open.authorityPartitionDigest &&
							existing.queryIdentity === open.queryIdentity &&
							sameBytes(existing.queryBytes, open.queryBytes) &&
							sameBytes(existing.inputBytes, open.inputBytes) &&
							sameBytes(existing.contextInputBytes, open.contextInputBytes) &&
							existing.inputDigest === open.inputDigest &&
							existing.wireVersion === open.wireVersion
						)
							return Object.freeze({
								status: "opened" as const,
								activeSlot: existing.activeSlot,
							});
						return unavailable;
					}
					const activeSlot = await transaction.execute(allocateWatchSlot, open);
					if (activeSlot === undefined) return limit;
					await transaction.execute(markScopeOpen, open);
					await transaction.execute(insertWatch, { open, activeSlot });
					return Object.freeze({ status: "opened" as const, activeSlot });
				},
			});
		},
		async scanOpenWatches(scope) {
			validateScopeLease(scope);
			return input.database.transaction({
				mode: readOnly,
				use: (transaction) => transaction.execute(scanOpenWatches, scope),
			});
		},
		async readOpenWatch(scope) {
			validateScope(scope);
			validBoundedIdentity(scope.bindingIdentity, "binding identity");
			return input.database.transaction({
				mode: readOnly,
				use: (transaction) => transaction.execute(readOpenWatch, scope),
			});
		},
		stageGeneration: input.generations.stageGeneration,
		acknowledgeWatch: input.generations.acknowledgeWatch,
		async closeWatch(close) {
			validateScope(close);
			validBoundedIdentity(close.bindingIdentity, "binding identity");
			return input.database.transaction({
				mode: readWrite,
				async use(transaction) {
					await transaction.execute(lockScope, scopeLockIdentity(close));
					return transaction.execute(closeWatch, close);
				},
			});
		},
		async withdrawScope(scope) {
			validateScopeLease(scope);
			return input.database.transaction({
				mode: readWrite,
				async use(transaction) {
					await transaction.execute(lockScope, scopeLockIdentity(scope));
					return transaction.execute(withdrawScope, scope);
				},
			});
		},
		async expireScopes(expiry) {
			validateApplicationIdentity(expiry.applicationName);
			validDigest(expiry.deploymentDigest, "deployment digest");
			return input.database.transaction({
				mode: readWrite,
				use: (transaction) => transaction.execute(expireScopes, expiry),
			});
		},
	});
}
