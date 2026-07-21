import { rm } from "node:fs/promises";

import type { HarnessAgentSession } from "@ai-sdk/harness/agent";

const TEARDOWN_TIMEOUT_MS = 5_000;

type SignalName = "SIGINT" | "SIGTERM";

interface SignalTarget {
	once(signal: SignalName, listener: () => void): unknown;
	off(signal: SignalName, listener: () => void): unknown;
}

export interface CodexSmokeCleanupScope {
	abortSignal: AbortSignal;
	setSession(session: HarnessAgentSession): void;
	setProviderCleanup(cleanup: () => Promise<void>): void;
	cleanup(): Promise<void>;
}

async function settleWithin(action: () => Promise<unknown>) {
	let timeout: ReturnType<typeof setTimeout> | undefined;
	try {
		await Promise.race([
			Promise.resolve()
				.then(action)
				.catch(() => undefined),
			new Promise<void>((resolve) => {
				timeout = setTimeout(resolve, TEARDOWN_TIMEOUT_MS);
			}),
		]);
	} finally {
		if (timeout) clearTimeout(timeout);
	}
}

export function createCodexSmokeCleanupScope(
	root: string,
): CodexSmokeCleanupScope {
	const abortController = new AbortController();
	let session: HarnessAgentSession | undefined;
	let providerCleanup: (() => Promise<void>) | undefined;
	let cleanupPromise: Promise<void> | undefined;

	return {
		abortSignal: abortController.signal,
		setSession(value) {
			session = value;
		},
		setProviderCleanup(value) {
			providerCleanup = value;
		},
		cleanup() {
			cleanupPromise ??= (async () => {
				abortController.abort();
				if (session) {
					await settleWithin(() => session!.destroy());
				}
				if (providerCleanup) {
					await settleWithin(providerCleanup);
				}
				await rm(root, { recursive: true, force: true });
			})();
			return cleanupPromise;
		},
	};
}

export async function runWithCodexSmokeCleanup<T>(
	root: string,
	action: (scope: CodexSmokeCleanupScope) => Promise<T>,
	options?: {
		signalTarget?: SignalTarget;
		exit?: (code: number) => void;
	},
): Promise<T> {
	const scope = createCodexSmokeCleanupScope(root);
	const signalTarget = options?.signalTarget ?? process;
	const exit = options?.exit ?? ((code) => process.exit(code));
	let signalHandled = false;
	const handlers = new Map<SignalName, () => void>();

	for (const [signal, code] of [
		["SIGINT", 130],
		["SIGTERM", 143],
	] as const) {
		const handler = () => {
			if (signalHandled) return;
			signalHandled = true;
			void scope.cleanup().finally(() => exit(code));
		};
		handlers.set(signal, handler);
		signalTarget.once(signal, handler);
	}

	try {
		return await action(scope);
	} finally {
		for (const [signal, handler] of handlers) {
			signalTarget.off(signal, handler);
		}
		await scope.cleanup();
	}
}

export const CODEX_SMOKE_EXPECTED_OUTPUT = "CODEX_COMPATIBILITY_OK";

export function isExactCodexSmokeOutput(text: string | undefined) {
	return text?.trim() === CODEX_SMOKE_EXPECTED_OUTPUT;
}
