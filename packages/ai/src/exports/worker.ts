import type { RuntimeKind } from "../server/modules/ai/services/provider-runtime.js";

export interface EmbeddedWorkerConfig {
  runtimes: { runtime: RuntimeKind; binaryPath?: string }[];
  maxConcurrentRuns?: number;
  workerDir?: string;
  name?: string;
  pollIntervalMs?: number;
}

export async function startAIWorker(
  app: any,
  config: EmbeddedWorkerConfig,
): Promise<{ stop(): Promise<void>; workerId: string }> {
  const { createDaemon } = await import("@questpie/agent-runtime/worker");
  const { generateSecret } = await import(
    "../server/modules/ai/services/worker-manager.js"
  );
  const os = await import("node:os");

  const adapters = await Promise.all(
    config.runtimes.map(async (r) => {
      if (r.runtime === "codex") {
        const { createCodexAdapter } = await import(
          "@questpie/agent-runtime/adapters/codex"
        );
        return createCodexAdapter();
      }
      const { createClaudeCodeAdapter } = await import(
        "@questpie/agent-runtime/adapters/claude-code"
      );
      return createClaudeCodeAdapter();
    }),
  );

  const daemon = createDaemon(
    {
      workerDir: config.workerDir ?? ".questpie/ai-worker",
      runtimes: config.runtimes.map((r) => ({
        runtime: r.runtime,
        binaryPath: r.binaryPath,
      })),
      pollIntervalMs: config.pollIntervalMs ?? 5000,
    },
    adapters,
  );

  await daemon.start();

  const secret = generateSecret();
  const hostname = config.name ?? os.hostname();
  const workerManager = app.services?.aiWorkerManager;
  const aiChat = app.services?.aiChat;

  let workerId = "embedded";
  if (workerManager) {
    const result = await workerManager.registerWorker({
      deviceId: `embedded:${daemon.volumeId}`,
      name: typeof hostname === "string" ? hostname : "embedded",
      volumeId: daemon.volumeId,
      capabilities: config.runtimes.map((r) => ({
        runtime: r.runtime,
        maxConcurrent: config.maxConcurrentRuns ?? 1,
      })),
      secret,
    });
    workerId = result.workerId;
  }

  let running = true;
  const pollLoop = async () => {
    while (running && workerManager) {
      try {
        await workerManager.heartbeat(workerId);
        const claimed = await workerManager.claimRun({
          workerId,
          runtimes: config.runtimes.map((r) => r.runtime),
          limit: 1,
        });

        if (claimed) {
          await executeRun(daemon, workerManager, aiChat, claimed, workerId);
        }
      } catch {}
      await new Promise((resolve) =>
        setTimeout(resolve, config.pollIntervalMs ?? 5000),
      );
    }
  };

  void pollLoop();

  return {
    workerId,
    async stop() {
      running = false;
      if (workerManager) {
        await workerManager.deregister(workerId);
      }
      await daemon.stop();
    },
  };
}

async function executeRun(
  daemon: any,
  workerManager: any,
  aiChat: any,
  claimed: any,
  workerId: string,
) {
  const handle = await daemon.submit({
    type: "message.send",
    runtime: claimed.runtime,
    prompt: claimed.prompt,
    sessionRef: claimed.sessionRef,
    priority: 100,
    meta: { runId: claimed.runId },
  });

  let sequence = 0;
  let accumulatedText = "";
  const toolCalls: { toolCallId: string; toolName: string; args: unknown }[] = [];

  for await (const event of handle.events) {
    await workerManager.reportEvent({
      runId: claimed.runId,
      event: { ...event, sequence: sequence++ },
    });

    if (event.type === "text.delta") {
      accumulatedText += event.text;
    } else if (event.type === "tool.started") {
      toolCalls.push({
        toolCallId: event.commandId ?? `tc_${sequence}`,
        toolName: event.tool,
        args: event.input,
      });
    }
  }

  const result = await handle.completion;

  if (aiChat && claimed.sessionId) {
    const content =
      toolCalls.length > 0
        ? [
            ...(accumulatedText
              ? [{ type: "text" as const, text: accumulatedText }]
              : []),
            ...toolCalls.map((tc) => ({
              type: "tool-call" as const,
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              args: tc.args,
            })),
          ]
        : accumulatedText;

    await aiChat.createAssistantMessage({
      sessionId: claimed.sessionId,
      runId: claimed.runId,
      content,
      model: claimed.modelId,
    });
  }

  await workerManager.completeRun({
    runId: claimed.runId,
    workerId,
    result,
  });
}
