import { afterEach, describe, expect, it } from "bun:test";
import { join } from "node:path";

import {
	ProductionServerStartError,
	startProductionServer,
	type ProductionServer,
} from "../src/scenario.js";

const packageRoot = join(import.meta.dirname, "..");
const fixture = join(import.meta.dirname, "fixtures", "production-server.ts");
const databaseUrl =
	"postgres://scenario:database-password@127.0.0.1:5432/qp_harness_fixture";
const printedSecret = "server-log-secret";
const liveServers = new Set<ProductionServer>();
const originalParentLeak = process.env.QP_PARENT_LEAK;

afterEach(async () => {
	await Promise.allSettled([...liveServers].map((server) => server.stop()));
	liveServers.clear();
	if (originalParentLeak === undefined) delete process.env.QP_PARENT_LEAK;
	else process.env.QP_PARENT_LEAK = originalParentLeak;
});

function start(mode = "ready", overrides: Record<string, unknown> = {}) {
	return startProductionServer({
		command: [process.execPath, fixture],
		cwd: packageRoot,
		databaseUrl,
		env: {
			HARNESS_MODE: mode,
			PRINT_SECRET: printedSecret,
		},
		secrets: [printedSecret],
		readiness: { path: "/health", timeoutMs: 2_000, pollIntervalMs: 20 },
		stopGraceMs: 100,
		portReleaseTimeoutMs: 1_000,
		...overrides,
	});
}

describe("production server harness", () => {
	it("rejects caller attempts to override harness-owned environment", async () => {
		await expect(
			startProductionServer({
				command: [process.execPath, fixture],
				cwd: packageRoot,
				databaseUrl,
				env: { DATABASE_URL: "postgres://wrong/production" },
				readiness: { path: "/health" },
			}),
		).rejects.toThrow("DATABASE_URL is managed");
	});

	it("boots with an allowlisted environment on a random loopback port", async () => {
		process.env.QP_PARENT_LEAK = "must-not-reach-child";
		const server = await start();
		liveServers.add(server);

		expect(server.port).toBeGreaterThan(0);
		expect([3_000, 6_007]).not.toContain(server.port);
		expect(server.baseUrl).toBe(`http://127.0.0.1:${server.port}`);
		const identity = (await fetch(`${server.baseUrl}/identity`).then(
			(response) => response.json(),
		)) as Record<string, unknown>;
		expect(identity.databaseUrl).toBe(databaseUrl);
		expect(identity.appUrl).toBe(server.baseUrl);
		expect(identity.parentLeak).toBeUndefined();
		expect(server.logTail().join("\n")).not.toContain(printedSecret);
		expect(server.logTail().join("\n")).toContain("[REDACTED]");
	});

	it("bounds the retained interleaved process logs", async () => {
		const server = await start("noisy", { maxLogLines: 5 });
		liveServers.add(server);

		expect(server.logTail(100)).toHaveLength(5);
		expect(server.logTail(100).at(-1)).toContain("ready pid=");
	});

	it("restarts on the same port and database with a fresh process", async () => {
		const server = await start();
		liveServers.add(server);
		const firstPid = server.pid();
		const port = server.port;

		await server.restart();

		expect(server.port).toBe(port);
		expect(server.pid()).not.toBe(firstPid);
		const identity = (await fetch(`${server.baseUrl}/identity`).then(
			(response) => response.json(),
		)) as Record<string, unknown>;
		expect(identity.databaseUrl).toBe(databaseUrl);
	});

	it("escalates to SIGKILL and proves the port can be rebound", async () => {
		const server = await start("ignore-term", { stopGraceMs: 20 });
		liveServers.add(server);
		const port = server.port;

		await Promise.all([server.stop(), server.stop()]);

		expect(server.pid()).toBeUndefined();
		const probe = Bun.listen({
			hostname: "127.0.0.1",
			port,
			socket: { data() {} },
		});
		probe.stop(true);
	});

	it("reports redacted log tails for early exit and readiness timeout", async () => {
		for (const [mode, phase] of [
			["early-exit", "early-exit"],
			["never-ready", "readiness"],
		] as const) {
			try {
				await start(mode, {
					readiness: {
						path: "/health",
						timeoutMs: mode === "never-ready" ? 120 : 2_000,
						pollIntervalMs: 20,
					},
				});
				expect.unreachable();
			} catch (error) {
				expect(error).toBeInstanceOf(ProductionServerStartError);
				expect(error).toMatchObject({ phase });
				expect((error as ProductionServerStartError).port).toBeNumber();
				if (phase === "early-exit") {
					expect((error as ProductionServerStartError).exitCode).toBe(7);
				}
				expect(String(error)).not.toContain(printedSecret);
				expect(
					(error as ProductionServerStartError).logTail.join("\n"),
				).not.toContain(printedSecret);
				expect(String(error)).toContain("Verify the built server command");
			}
		}
	});
});
