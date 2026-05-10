import type { RuntimeKind, RuntimeConfig } from "./runtime.js";
import type { RuntimeCommand, CommandHandle } from "./commands.js";
import type { SessionEntry, SessionSnapshot } from "./sessions.js";
import type { SessionStorageAdapter } from "./storage.js";
import type { RuntimeProfile } from "./profiles.js";

export interface DaemonConfig {
	readonly workerDir: string;
	readonly runtimes: readonly RuntimeConfig[];
	readonly sessionStorage?: SessionStorageAdapter;
	readonly concurrency?: Partial<Record<RuntimeKind, number>>;
	readonly pollIntervalMs?: number;
	readonly heartbeatIntervalMs?: number;
	readonly staleLockTimeoutMs?: number;
}

export interface DaemonStatus {
	readonly volumeId: string;
	readonly runtimes: readonly {
		kind: RuntimeKind;
		detected: boolean;
		version?: string;
	}[];
	readonly activeCommands: number;
	readonly queuedCommands: number;
	readonly uptime: number;
}

export interface Daemon {
	start(): Promise<void>;
	stop(): Promise<void>;

	submit(command: RuntimeCommand): Promise<CommandHandle>;

	getStatus(): DaemonStatus;
	listSessions(runtime?: RuntimeKind): Promise<SessionEntry[]>;
	getSession(
		runtime: RuntimeKind,
		sessionRef: string,
	): Promise<SessionSnapshot>;

	setProfile(profile: RuntimeProfile): Promise<void>;
	removeProfile(profileId: string): Promise<void>;
	listProfiles(): RuntimeProfile[];

	readonly volumeId: string;
	readonly isRunning: boolean;
}
