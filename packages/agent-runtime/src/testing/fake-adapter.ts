import { randomUUID } from "node:crypto";
import type {
	RuntimeAdapter,
	RuntimeDetectionInput,
	RuntimeDetectionResult,
	RuntimeAdapterContext,
	RuntimeStorageInfo,
	RuntimeListSessionsInput,
	RuntimeGetSessionInput,
	RuntimeSendMessageInput,
	RuntimeConfigureInput,
	RuntimeConfigureResult,
	RuntimeCancelInput,
} from "../types/adapter.js";
import type { RuntimeEvent } from "../types/events.js";
import type { RuntimeKind } from "../types/runtime.js";
import type { SessionEntry, SessionSnapshot } from "../types/sessions.js";

export interface FakeAdapterOptions {
	readonly kind?: RuntimeKind;
	readonly responseText?: string;
	readonly responseDelayMs?: number;
	readonly shouldFail?: boolean;
	readonly failMessage?: string;
}

export function createFakeAdapter(
	options: FakeAdapterOptions = {},
): RuntimeAdapter {
	const kind = options.kind ?? "claude-code";
	const sessions = new Map<string, SessionEntry>();

	return {
		kind,

		async detect(): Promise<RuntimeDetectionResult> {
			return {
				available: true,
				version: "fake-1.0.0",
				binaryPath: "/usr/bin/fake-agent",
				supportsSessions: true,
				supportsMcp: true,
				supportsSkills: true,
			};
		},

		async getStorageInfo(
			input: RuntimeAdapterContext,
		): Promise<RuntimeStorageInfo> {
			return {
				homePath: `${input.workerDir}/homes/${kind}`,
			};
		},

		async listSessions(): Promise<SessionEntry[]> {
			return [...sessions.values()];
		},

		async getSession(input: RuntimeGetSessionInput): Promise<SessionSnapshot> {
			const session = sessions.get(input.sessionRef);
			if (!session) {
				const { AgentRuntimeError } = await import("../types/errors.js");
				throw new AgentRuntimeError(
					"SESSION_NOT_FOUND_ON_VOLUME",
					`Fake session ${input.sessionRef} not found`,
					{ runtime: kind },
				);
			}
			return { ...session };
		},

		async *sendMessage(
			input: RuntimeSendMessageInput,
		): AsyncIterable<RuntimeEvent> {
			const sessionRef =
				input.sessionRef ?? `fake_${randomUUID().slice(0, 8)}`;

			yield {
				type: "command.started",
				commandId: input.commandId,
				runtime: kind,
			};

			yield {
				type: "session.resolved",
				commandId: input.commandId,
				sessionRef,
				isNew: !input.sessionRef,
			};

			if (options.responseDelayMs) {
				await new Promise((r) =>
					setTimeout(r, options.responseDelayMs),
				);
			}

			if (options.shouldFail) {
				const { AgentRuntimeError } = await import("../types/errors.js");
				yield {
					type: "command.failed",
					commandId: input.commandId,
					error: new AgentRuntimeError(
						"RUNTIME_EXITED_NON_ZERO",
						options.failMessage ?? "Fake failure",
						{ runtime: kind },
					),
				};
				return;
			}

			const text =
				options.responseText ?? `Fake response to: ${input.prompt}`;
			yield {
				type: "text.delta",
				commandId: input.commandId,
				text,
			};

			yield {
				type: "usage",
				commandId: input.commandId,
				inputTokens: 100,
				outputTokens: 50,
			};

			sessions.set(sessionRef, {
				runtime: kind,
				sessionRef,
				title: `Session from: ${input.prompt.slice(0, 50)}`,
				cwd: input.cwd,
				createdAt: new Date(),
				updatedAt: new Date(),
			});

			yield {
				type: "command.completed",
				commandId: input.commandId,
				result: {
					text,
					sessionRef,
					inputTokens: 100,
					outputTokens: 50,
					stopReason: "end_turn",
				},
			};
		},

		async configure(): Promise<RuntimeConfigureResult> {
			return { applied: true };
		},

		async cancel(): Promise<void> {},
	};
}
