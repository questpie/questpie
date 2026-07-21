import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	HarnessV1NetworkSandboxSession,
	HarnessV1SandboxProvider,
	HarnessV1Skill,
} from "@ai-sdk/harness";
import {
	createClaudeCode,
	VERSION as CLAUDE_CODE_VERSION,
} from "@ai-sdk/harness-claude-code";
import { createCodex, VERSION as CODEX_VERSION } from "@ai-sdk/harness-codex";
import { HarnessAgent } from "@ai-sdk/harness/agent";
import type { Experimental_SandboxSession } from "@ai-sdk/provider-utils";

import { createLocalHostSandbox } from "../../../../worker/local-host-sandbox.js";

const roots: string[] = [];

const skill: HarnessV1Skill = {
	name: "stable-train-smoke",
	description: "Proves stable Harness skill materialization.",
	content: "Use the stable adapter train.",
	files: [{ path: "references/train.md", content: "ai@7.0.22" }],
};

const adapters = [
	{
		name: "claude-code",
		version: CLAUDE_CODE_VERSION,
		expectedVersion: "1.0.27",
		create: () => createClaudeCode({ startupTimeoutMs: 10 }),
		skillRoot: [".claude", "skills"],
	},
	{
		name: "codex",
		version: CODEX_VERSION,
		expectedVersion: "1.0.29",
		create: () => createCodex({ startupTimeoutMs: 10 }),
		skillRoot: [".agents", "skills"],
	},
] as const;

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true })),
	);
});

async function createLifecycleFixture(name: string) {
	const root = await mkdtemp(join(tmpdir(), `questpie-${name}-stable-`));
	roots.push(root);
	const bootstrapSourcePrefix = `/tmp/harness/${name}`;
	const bootstrapRoot = join(root, "bootstrap", name);
	const bootstrapCommands: string[] = [];
	const baseProvider = createLocalHostSandbox({ workRoot: join(root, "work") });

	function mapBootstrapPath(path: string) {
		if (path === bootstrapSourcePrefix) return bootstrapRoot;
		if (path.startsWith(`${bootstrapSourcePrefix}/`)) {
			return join(bootstrapRoot, path.slice(bootstrapSourcePrefix.length + 1));
		}
		return path;
	}

	function wrapRestrictedSession(session: HarnessV1NetworkSandboxSession) {
		const restricted = session.restricted();
		return {
			...restricted,
			readTextFile: (options) =>
				restricted.readTextFile({
					...options,
					path: mapBootstrapPath(options.path),
				}),
			writeTextFile: (options) =>
				restricted.writeTextFile({
					...options,
					path: mapBootstrapPath(options.path),
				}),
			async run(options) {
				if (options.command.includes(bootstrapSourcePrefix)) {
					bootstrapCommands.push(options.command);
					return { exitCode: 0, stdout: "", stderr: "" };
				}
				return restricted.run(options);
			},
			async spawn() {
				throw new Error("provider turn blocked by stable adapter smoke test");
			},
		} satisfies Experimental_SandboxSession;
	}

	const provider: HarnessV1SandboxProvider = {
		specificationVersion: "harness-sandbox-v1",
		providerId: `questpie-${name}-stable-test`,
		async createSession(options) {
			const session = await baseProvider.createSession({
				sessionId: options?.sessionId,
				abortSignal: options?.abortSignal,
			});
			const restricted = wrapRestrictedSession(session);
			await options?.onFirstCreate?.(restricted, {
				abortSignal: options.abortSignal,
			});
			return {
				...session,
				restricted: () => restricted,
			} satisfies HarnessV1NetworkSandboxSession;
		},
	};

	return { bootstrapCommands, bootstrapRoot, provider };
}

describe("stable Harness adapter package train", () => {
	for (const adapterCase of adapters) {
		it(`${adapterCase.name} imports its exact factory and bootstrap recipe`, async () => {
			const adapter = adapterCase.create();
			const bootstrap = await adapter.getBootstrap?.();

			expect(adapterCase.version).toBe(adapterCase.expectedVersion);
			expect(adapter.specificationVersion).toBe("harness-v1");
			expect(adapter.harnessId).toBe(adapterCase.name);
			expect(bootstrap?.harnessId).toBe(adapterCase.name);
			expect(
				bootstrap?.files.some((file) => file.path.endsWith("bridge.mjs")),
			).toBe(true);
			expect(
				bootstrap?.commands.some((command) =>
					command.command.includes("install --frozen-lockfile"),
				),
			).toBe(true);
		});

		it(`${adapterCase.name} applies bootstrap and materializes isolated HarnessAgent sessions before a provider turn`, async () => {
			const fixture = await createLifecycleFixture(adapterCase.name);
			const lifecycle: Array<{ home: string; sessionWorkDir: string }> = [];
			const agent = new HarnessAgent({
				harness: adapterCase.create(),
				sandbox: fixture.provider,
				skills: [skill],
				permissionMode: "allow-all",
				sandboxConfig: {
					async onSession({ session, sessionWorkDir }) {
						const home = await session.run({
							command: "printf '%s' \"$HOME\"",
						});
						lifecycle.push({ home: home.stdout, sessionWorkDir });
					},
				},
			});
			const sessionIds = [
				`${adapterCase.name}-first`,
				`${adapterCase.name}-second`,
			];

			for (const sessionId of sessionIds) {
				await expect(agent.createSession({ sessionId })).rejects.toThrow(
					"provider turn blocked by stable adapter smoke test",
				);
			}

			expect(lifecycle).toHaveLength(2);
			expect(lifecycle[0]!.home).not.toBe(lifecycle[1]!.home);
			for (const [index, sessionId] of sessionIds.entries()) {
				const state = lifecycle[index]!;
				expect(state.home).toContain(sessionId);
				expect(state.sessionWorkDir).toContain(
					`${adapterCase.name}-${sessionId}`,
				);

				const skillDir = join(state.home, ...adapterCase.skillRoot, skill.name);
				const skillFile = await readFile(join(skillDir, "SKILL.md"), "utf8");
				expect(skillFile).toContain(skill.description);
				expect(skillFile).toContain(skill.content);
				expect(
					await readFile(join(skillDir, "references/train.md"), "utf8"),
				).toBe("ai@7.0.22");
			}

			expect(
				fixture.bootstrapCommands.some((command) =>
					command.includes("install --frozen-lockfile"),
				),
			).toBe(true);
			expect(
				await readFile(join(fixture.bootstrapRoot, "bridge.mjs"), "utf8"),
			).toContain("WebSocket");
		});
	}
});
