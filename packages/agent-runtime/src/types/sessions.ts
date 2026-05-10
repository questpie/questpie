import type { RuntimeKind } from "./runtime.js";

export interface SessionEntry {
	readonly runtime: RuntimeKind;
	readonly sessionRef: string;
	readonly title?: string;
	readonly cwd?: string;
	readonly createdAt?: Date;
	readonly updatedAt?: Date;
}

export interface SessionSnapshot extends SessionEntry {
	readonly messageCount?: number;
	readonly totalTokens?: number;
}

export interface SessionPointer {
	readonly runtime: RuntimeKind;
	readonly sessionRef: string;
}
