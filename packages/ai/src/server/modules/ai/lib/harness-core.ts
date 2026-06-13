import type { Experimental_SandboxSession } from "@ai-sdk/provider-utils";
import {
	HarnessAgent,
	type HarnessAgentPermissionMode,
	type HarnessAgentResumeSessionState,
	type HarnessAgentSession,
	type HarnessAgentSettings,
	type HarnessAgentSkill,
} from "@ai-sdk/harness/agent";
import {
	createClaudeCode,
	type ClaudeCodeHarnessSettings,
} from "@ai-sdk/harness-claude-code";
import {
	toUIMessageStream,
	type InferUIMessageChunk,
	type StreamTextResult,
	type ToolSet,
	type UIMessage,
	type UIMessageStreamOptions,
} from "ai";

import {
	createLocalHostSandbox,
	type LocalHostSandboxSettings,
} from "../../../worker/local-host-sandbox.js";

export type HarnessCoreRuntime = "claude-code";

export interface HarnessSandboxSessionOptions {
	session: Experimental_SandboxSession;
	sessionWorkDir: string;
	abortSignal?: AbortSignal;
	mcpServers?: unknown[];
}

export interface CreateHarnessAgentOptions<TTools extends ToolSet = {}> {
	runtime?: HarnessCoreRuntime;
	key?: string;
	workRoot: string;
	instructions?: string;
	skills?: ReadonlyArray<HarnessAgentSkill>;
	tools?: TTools;
	permissionMode?: HarnessAgentPermissionMode;
	claudeCode?: ClaudeCodeHarnessSettings;
	mcpServers?: unknown[];
	sandbox?: Omit<LocalHostSandboxSettings, "workRoot">;
	onSandboxSession?: (options: HarnessSandboxSessionOptions) => Promise<void>;
}

export interface HarnessSessionStore {
	load(id: string): Promise<HarnessAgentResumeSessionState | null | undefined>;
	save(id: string, state: HarnessAgentResumeSessionState): Promise<void>;
}

export interface ResumeOrCreateSessionOptions {
	agent: Pick<HarnessAgent, "createSession">;
	id: string;
	abortSignal?: AbortSignal;
	loadResumeState?: (
		id: string,
	) => Promise<HarnessAgentResumeSessionState | null | undefined>;
	saveResumeState?: (
		id: string,
		state: HarnessAgentResumeSessionState,
	) => Promise<void>;
}

export interface ResumedHarnessSession {
	session: HarnessAgentSession;
	resumeFrom?: HarnessAgentResumeSessionState;
	isResume: boolean;
	detachAndPersist(): Promise<HarnessAgentResumeSessionState>;
}

export type HarnessStreamTurnOptions<TAgent extends HarnessAgent> = Omit<
	Parameters<TAgent["stream"]>[0],
	"session"
> & {
	session: HarnessAgentSession;
};

export type HarnessStreamTurnResult<TAgent extends HarnessAgent> = Awaited<
	ReturnType<TAgent["stream"]>
>;

export function createHarnessAgent<TTools extends ToolSet = {}>(
	options: CreateHarnessAgentOptions<TTools>,
): HarnessAgent<any, TTools> {
	const runtime = options.runtime ?? "claude-code";
	if (runtime !== "claude-code") {
		throw new Error(`Unsupported harness runtime "${runtime}"`);
	}
	const onSandboxSession = options.onSandboxSession;

	return new HarnessAgent({
		id: options.key,
		harness: createClaudeCode(options.claudeCode),
		sandbox: createLocalHostSandbox({
			...options.sandbox,
			workRoot: options.workRoot,
		}),
		instructions: options.instructions,
		skills: options.skills,
		tools: options.tools,
		permissionMode: options.permissionMode,
		onSandboxSession: onSandboxSession
			? (sessionOptions) =>
					onSandboxSession({
						...sessionOptions,
						mcpServers: options.mcpServers,
					})
			: undefined,
	} satisfies HarnessAgentSettings<ReturnType<typeof createClaudeCode>, TTools>);
}

export function createInMemoryHarnessSessionStore(): HarnessSessionStore {
	const states = new Map<string, HarnessAgentResumeSessionState>();
	return {
		async load(id) {
			return states.get(id);
		},
		async save(id, state) {
			states.set(id, state);
		},
	};
}

export const inMemoryHarnessSessionStore =
	createInMemoryHarnessSessionStore();

export async function resumeOrCreateSession(
	options: ResumeOrCreateSessionOptions,
): Promise<ResumedHarnessSession> {
	const resumeFrom =
		(await options.loadResumeState?.(options.id)) ?? undefined;
	const session = await options.agent.createSession({
		sessionId: options.id,
		resumeFrom,
		abortSignal: options.abortSignal,
	});

	return {
		session,
		resumeFrom,
		isResume: session.isResume,
		async detachAndPersist() {
			const state = await session.detach();
			await options.saveResumeState?.(options.id, state);
			return state;
		},
	};
}

export async function streamTurn<TAgent extends HarnessAgent>(
	agent: TAgent,
	options: HarnessStreamTurnOptions<TAgent>,
): Promise<HarnessStreamTurnResult<TAgent>> {
	return agent.stream(options as Parameters<TAgent["stream"]>[0]) as Promise<
		HarnessStreamTurnResult<TAgent>
	>;
}

export function toUIMessages<
	TOOLS extends ToolSet,
	UI_MESSAGE extends UIMessage = UIMessage,
>(
	result: StreamTextResult<TOOLS, any, never>,
	options?: UIMessageStreamOptions<UI_MESSAGE> & { tools?: TOOLS },
): ReadableStream<InferUIMessageChunk<UI_MESSAGE>> {
	const { tools, ...streamOptions } = options ?? {};
	return toUIMessageStream<TOOLS, UI_MESSAGE>({
		stream: result.stream,
		tools,
		...streamOptions,
	});
}
