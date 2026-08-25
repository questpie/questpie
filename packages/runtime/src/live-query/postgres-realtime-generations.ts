import type {
	PostgresRealtimeAcknowledgement,
	PostgresRealtimeGenerationStage,
} from "./postgres-realtime-scope-contract";

export type PostgresRealtimeGenerationStore = Readonly<{
	stageGeneration(input: PostgresRealtimeGenerationStage): Promise<boolean>;
	acknowledgeWatch(input: PostgresRealtimeAcknowledgement): Promise<boolean>;
}>;
