import { randomUUID } from "node:crypto";

import type { AgentRuntimeRunner } from "../modules/ai/lib/execution-contract.js";

export interface FakeAgentRuntimeRunnerOptions {
	responseText?: string;
	sessionRef?: string;
	shouldFail?: boolean;
	failMessage?: string;
}

export function createFakeAgentRuntimeRunner(
	options: FakeAgentRuntimeRunnerOptions = {},
): AgentRuntimeRunner {
	return {
		async run(input) {
			const commandId = `cmd_${randomUUID().slice(0, 12)}`;
			const sessionRef =
				input.runtimeSessionRef ??
				options.sessionRef ??
				`fake_${randomUUID().slice(0, 8)}`;
			const responseText =
				options.responseText ?? `Fake response to: ${input.prompt}`;

			if (options.shouldFail) {
				const completion = async () => {
					throw new Error(options.failMessage ?? "Fake failure");
				};
				return {
					events: eventsFrom([
						{
							type: "command.started",
							commandId,
							runtime: input.runtime,
						},
					]),
					completion: completion(),
				};
			}

			const result = {
				text: responseText,
				sessionRef,
				inputTokens: 100,
				outputTokens: 50,
				stopReason: "end_turn",
			};

			return {
				events: eventsFrom([
					{
						type: "command.started",
						commandId,
						runtime: input.runtime,
					},
					{
						type: "session.resolved",
						commandId,
						sessionRef,
						isNew: !input.runtimeSessionRef,
					},
					{
						type: "text.delta",
						commandId,
						text: responseText,
					},
					{
						type: "usage",
						commandId,
						inputTokens: 100,
						outputTokens: 50,
					},
					{
						type: "command.completed",
						commandId,
						result,
					},
				]),
				completion: Promise.resolve(result),
			};
		},
	};
}

async function* eventsFrom(events: Record<string, unknown>[]) {
	for (const event of events) {
		yield event;
	}
}
