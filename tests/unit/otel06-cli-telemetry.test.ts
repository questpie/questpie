import { afterAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createStartShutdown,
	createTelemetryApplication,
	loadOpenTelemetry,
	requestedTelemetry,
} from "../../packages/questpie/cli/telemetry";

const temporaryRoots: string[] = [];

afterAll(async () => {
	await Promise.all(
		temporaryRoots.map((root) => rm(root, { force: true, recursive: true })),
	);
});

test("admits only one exact explicit OpenTelemetry start flag", () => {
	expect(requestedTelemetry(["--port", "0"])).toBeNull();
	expect(requestedTelemetry(["--telemetry=opentelemetry", "--port=0"])).toBe(
		"opentelemetry",
	);

	for (const invalid of [
		["--telemetry"],
		["--telemetry", "opentelemetry"],
		["--telemetry="],
		["--telemetry=none"],
		["--telemetry=opentelemetry", "--telemetry=opentelemetry"],
	] as const)
		expect(() => requestedTelemetry(invalid)).toThrow(
			"QP-START-004 telemetryUnavailable",
		);
});

async function applicationWithAdapter(source: string): Promise<string> {
	const root = await mkdtemp(join(tmpdir(), "questpie-otel06-loader-"));
	temporaryRoots.push(root);
	const packageRoot = join(root, "node_modules/@questpie/opentelemetry");
	await mkdir(packageRoot, { recursive: true });
	await writeFile(
		join(packageRoot, "package.json"),
		JSON.stringify({
			name: "@questpie/opentelemetry",
			type: "module",
			exports: "./index.js",
		}),
	);
	await writeFile(join(packageRoot, "index.js"), source);
	return root;
}

test("resolves and classifies explicit telemetry only from the application root", async () => {
	const applicationRoot = await applicationWithAdapter(`
		export async function createOpenTelemetry() {
			return Object.freeze({ close: async () => undefined });
		}
	`);
	const telemetry = await loadOpenTelemetry(applicationRoot);
	expect(typeof telemetry.close).toBe("function");
	await telemetry.close();

	const missingExport = await applicationWithAdapter(
		"export const nope = true;",
	);
	await expect(loadOpenTelemetry(missingExport)).rejects.toThrow(
		"QP-START-004 telemetryUnavailable",
	);
	const invalid = await applicationWithAdapter(`
		export function createOpenTelemetry() {
			throw new TypeError("QP-OTEL-001 invalidConfiguration: environment.OTEL_BSP_MAX_QUEUE_SIZE");
		}
	`);
	await expect(loadOpenTelemetry(invalid)).rejects.toThrow(
		"QP-START-004 telemetryInvalidConfiguration: environment.OTEL_BSP_MAX_QUEUE_SIZE",
	);
	const hostile = await applicationWithAdapter(`
		export function createOpenTelemetry() {
			throw new TypeError("QP-OTEL-001 invalidConfiguration: secret-value");
		}
	`);
	await expect(loadOpenTelemetry(hostile)).rejects.toThrow(
		"QP-START-004 telemetryUnavailable",
	);
});

test("owns App then telemetry cleanup with the App failure primary", async () => {
	const createFailure = new Error("app create failed");
	let telemetryCloseCount = 0;
	const telemetry = {
		observability: Object.freeze({}),
		async close() {
			telemetryCloseCount += 1;
			throw new Error("telemetry close failed");
		},
	};
	await expect(
		createTelemetryApplication(telemetry, async () => {
			throw createFailure;
		}),
	).rejects.toBe(createFailure);
	expect(telemetryCloseCount).toBe(1);
	await expect(
		createTelemetryApplication(telemetry, async () => {
			throw new TypeError("Runtime observation handle is incompatible");
		}),
	).rejects.toThrow("QP-START-004 telemetryUnavailable");
	expect(telemetryCloseCount).toBe(2);

	const order: string[] = [];
	const closeFailure = new Error("app close failed");
	const shutdown = createStartShutdown({
		stopIngress() {
			order.push("ingress.stop");
		},
		application: {
			async close() {
				order.push("app.close");
				throw closeFailure;
			},
		},
		telemetry: {
			observability: Object.freeze({}),
			async close() {
				order.push("telemetry.close");
				throw new Error("telemetry close failed");
			},
		},
	});
	const first = shutdown();
	const second = shutdown();
	expect(second).toBe(first);
	await expect(first).rejects.toBe(closeFailure);
	expect(order).toEqual(["ingress.stop", "app.close", "telemetry.close"]);
});
