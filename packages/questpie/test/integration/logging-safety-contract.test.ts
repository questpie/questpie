import { describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { runWithContext } from "../../src/server/config/context.js";
import { LoggerService } from "../../src/server/modules/core/integrated/logger/service.js";
import { createCapturingLogger } from "../utils/capturing-logger.js";

const contextModule = pathToFileURL(
	resolve(import.meta.dir, "../../src/server/config/context.ts"),
).href;
const loggerModule = pathToFileURL(
	resolve(
		import.meta.dir,
		"../../src/server/modules/core/integrated/logger/service.ts",
	),
).href;

describe("logging safety contract", () => {
	it("tees the same correlated structured record sent to the logger adapter", async () => {
		const captured = createCapturingLogger();
		const emitted: unknown[] = [];
		const logger = new LoggerService({ adapter: captured.adapter });
		await runWithContext(
			{
				requestId: "req-contract",
				traceId: "framework-trace",
				app: {
					observability: {
						activeSpanContext: () => ({
							traceId: "a".repeat(32),
							spanId: "b".repeat(16),
						}),
						emitLog: (record: unknown) => emitted.push(record),
					},
				},
			},
			async () => logger.info("contract event", { event: "contract.event" }),
		);

		const attributes = captured.records[0]?.args?.[0];
		expect(attributes).toMatchObject({
			event: "contract.event",
			requestId: "req-contract",
			traceId: "framework-trace",
			trace_id: "a".repeat(32),
			span_id: "b".repeat(16),
		});
		expect(emitted[0]).toMatchObject({ message: "contract event", attributes });
	});

	it("redacts structured credentials and errors but preserves the caller message", () => {
		const captured = createCapturingLogger();
		const logger = new LoggerService({ adapter: captured.adapter });
		logger.error("stable caller message", {
			authorization: "private",
			nested: { accessToken: "private" },
			error: new Error("private error"),
		});

		expect(captured.records[0]).toEqual({
			level: "error",
			message: "stable caller message",
			args: [
				{
					authorization: "[Redacted]",
					nested: { accessToken: "[Redacted]" },
					error: { type: "Error", message: "[Redacted]" },
				},
			],
		});
	});

	it("sends the same safe final record through real Pino", async () => {
		const child = Bun.spawn(
			[
				process.execPath,
				"--eval",
				`import { runWithContext } from ${JSON.stringify(contextModule)};
				 import { LoggerService } from ${JSON.stringify(loggerModule)};
				 const logger = new LoggerService({ pretty: false, redact: ["requestId", "err.code"] });
				 await runWithContext({ requestId: "private-request" }, async () => {
				   logger.child({ component: "billing", authorization: "private-auth" })
				     .error("stable", Object.assign(new TypeError("private-error"), { code: "private-code" }));
				 });`,
			],
			{
				cwd: resolve(import.meta.dir, "../../../.."),
				env: { ...process.env, NODE_ENV: "production" },
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		expect(exitCode).toBe(0);
		expect(stderr).toBe("");
		expect(stdout).not.toContain("private-request");
		expect(stdout).not.toContain("private-auth");
		expect(stdout).not.toContain("private-error");
		expect(stdout).not.toContain("private-code");
		expect(JSON.parse(stdout.trim())).toMatchObject({
			component: "billing",
			authorization: "[Redacted]",
			requestId: "[Redacted]",
			err: { type: "TypeError", message: "[Redacted]", code: "[Redacted]" },
		});
	});
});
