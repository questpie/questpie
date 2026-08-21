import type {
	PostgresRealtimeAcknowledgement,
	PostgresRealtimeGenerationStage,
	PostgresRealtimeOpenWatch,
	PostgresRealtimeScopeAuthority,
	PostgresRealtimeScopeLease,
	PostgresRealtimeWatch,
} from "./postgres-realtime-scope-contract";

export type PostgresRealtimeScopeStore = Readonly<{
	attachScope(
		input: PostgresRealtimeScopeAuthority,
	): Promise<
		| Readonly<{ status: "attached"; holderGeneration: bigint }>
		| Readonly<{ status: "unavailable" }>
	>;
	renewScope(input: PostgresRealtimeScopeLease): Promise<boolean>;
	openWatch(
		input: PostgresRealtimeOpenWatch,
	): Promise<
		| Readonly<{ status: "opened"; activeSlot: number }>
		| Readonly<{ status: "unavailable" }>
		| Readonly<{ status: "limit" }>
	>;
	scanOpenWatches(
		input: PostgresRealtimeScopeLease,
	): Promise<readonly PostgresRealtimeWatch[]>;
	readOpenWatch(
		input: PostgresRealtimeScopeAuthority &
			Readonly<{ bindingIdentity: string }>,
	): Promise<PostgresRealtimeWatch | undefined>;
	stageGeneration(input: PostgresRealtimeGenerationStage): Promise<boolean>;
	acknowledgeWatch(input: PostgresRealtimeAcknowledgement): Promise<boolean>;
	closeWatch(
		input: PostgresRealtimeScopeAuthority &
			Readonly<{ bindingIdentity: string }>,
	): Promise<boolean>;
	withdrawScope(input: PostgresRealtimeScopeLease): Promise<boolean>;
	expireScopes(
		input: Readonly<{
			applicationName: string;
			deploymentDigest: string;
		}>,
	): Promise<Readonly<{ scopes: number; watches: number }>>;
}>;
