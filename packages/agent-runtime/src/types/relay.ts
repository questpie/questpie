import type { RuntimeKind } from "./runtime.js";
import type { RuntimeCommand, CommandHandle } from "./commands.js";
import type { RuntimeEvent } from "./events.js";
import type { CommandResult } from "./commands.js";

export interface WorkerIdentity {
	readonly workerId: string;
	readonly volumeId: string;
	readonly capabilities: WorkerCapabilities;
}

export interface WorkerCapabilities {
	readonly runtimes: readonly {
		kind: RuntimeKind;
		models?: string[];
		tags?: string[];
	}[];
	readonly maxConcurrent: number;
}

export interface RelayConfig {
	readonly auth: {
		validateWorker(request: Request): Promise<WorkerIdentity | null>;
	};
	readonly onWorkerRegistered?: (worker: WorkerIdentity) => void;
	readonly onWorkerOffline?: (workerId: string) => void;
}

export interface Relay {
	handleRequest(request: Request): Promise<Response>;

	submitCommand(
		command: RelayCommandInput,
	): Promise<RelayCommandHandle>;

	getConnectedWorkers(): WorkerIdentity[];
	getWorker(workerId: string): WorkerIdentity | null;
}

export interface RelayCommandInput {
	readonly command: RuntimeCommand & { type: "message.send" };
	readonly targetVolumeId?: string;
	readonly targetRuntimeKind: RuntimeKind;
	readonly targetModel?: string;
}

export interface RelayCommandHandle {
	readonly commandId: string;
	readonly events: AsyncIterable<RuntimeEvent>;
	readonly completion: Promise<CommandResult>;
	cancel(): Promise<void>;
}
