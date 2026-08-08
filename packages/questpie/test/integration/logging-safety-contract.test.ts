import { afterEach, describe, expect, it } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { z } from "zod";

import { route } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { ObservabilityService } from "../../src/server/modules/core/integrated/observability/service.js";
import type {
	ObservabilityAdapter,
	ObservabilityAttributeValue,
	ObservabilitySpan,
} from "../../src/server/modules/core/integrated/observability/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";

const ACTIVE_TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const ACTIVE_SPAN_ID = "00f067aa0ba902b7";
const SAFE_CORRELATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const contextModule = pathToFileURL(
	resolve(import.meta.dir, "../../src/server/config/context.ts"),
).href;
const loggerModule = pathToFileURL(
	resolve(
		import.meta.dir,
		"../../src/server/modules/core/integrated/logger/service.ts",
	),
).href;

async function runDefaultLogger(script: string) {
	const child = Bun.spawn([process.execPath, "--eval", script], {
		cwd: resolve(import.meta.dir, "../../../.."),
		env: { ...process.env, NODE_ENV: "production" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [stdout, stderr, exitCode] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);
	return { stdout, stderr, exitCode };
}

describe("logging safety contract", () => {
	it("F01 tees the correlated structured Pino record onto OTLP", async () => {
		const result = await runDefaultLogger(`
			import { runWithContext } from ${JSON.stringify(contextModule)};
			import { LoggerService } from ${JSON.stringify(loggerModule)};
			const emitted = [];
			const observability = {
				activeSpanContext: () => ({
					traceId: ${JSON.stringify(ACTIVE_TRACE_ID)},
					spanId: ${JSON.stringify(ACTIVE_SPAN_ID)},
				}),
				emitLog: (record) => emitted.push(record),
			};
			const logger = new LoggerService({ pretty: false });
			await runWithContext({
				requestId: "req-contract",
				traceId: "framework-trace",
				app: { observability },
			}, async () => logger.info("contract event", {
				event: "contract.event",
				orderId: "order-1",
			}));
			process.stderr.write(JSON.stringify(emitted));
		`);

		expect(result.exitCode).toBe(0);
		const stdoutRecord = JSON.parse(result.stdout.trim());
		const [otlpRecord] = JSON.parse(result.stderr);
		const expected = {
			event: "contract.event",
			orderId: "order-1",
			requestId: "req-contract",
			traceId: "framework-trace",
			trace_id: ACTIVE_TRACE_ID,
			span_id: ACTIVE_SPAN_ID,
		};

		expect(stdoutRecord).toMatchObject(expected);
		expect(otlpRecord).toMatchObject({
			level: "info",
			message: "contract event",
			attributes: expected,
		});
	});

	it("F03 omits nested credential and Error secrets from Pino stdout", async () => {
		const secrets = [
			"authorization-secret-761",
			"cookie-secret-294",
			"password-secret-853",
			"token-secret-417",
			"api-key-secret-638",
			"error-secret-902",
		];
		const result = await runDefaultLogger(`
			import { LoggerService } from ${JSON.stringify(loggerModule)};
			const logger = new LoggerService({ pretty: false });
			logger.info("credential event", {
				request: {
					headers: {
						authorization: "${secrets[0]}",
						cookie: "${secrets[1]}",
					},
					body: { password: "${secrets[2]}" },
				},
				auth: {
					accessToken: "${secrets[3]}",
					credentials: { apiKey: "${secrets[4]}" },
				},
			});
			logger.error("credential failure", new Error("failed: ${secrets[5]}"));
		`);

		expect(result.exitCode).toBe(0);
		for (const secret of secrets) {
			expect(result.stdout).not.toContain(secret);
		}
	});

	it("F03 omits nested credential and Error secrets from the OTLP tee", async () => {
		const secrets = [
			"authorization-secret-182",
			"cookie-secret-735",
			"password-secret-469",
			"token-secret-316",
			"api-key-secret-847",
			"error-secret-593",
		];
		const result = await runDefaultLogger(`
			import { runWithContext } from ${JSON.stringify(contextModule)};
			import { LoggerService } from ${JSON.stringify(loggerModule)};
			const emitted = [];
			const observability = { emitLog: (record) => emitted.push(record) };
			const logger = new LoggerService({ pretty: false });
			await runWithContext({ app: { observability } }, async () => {
				logger.info("credential event", {
					request: {
						headers: {
							authorization: "${secrets[0]}",
							cookie: "${secrets[1]}",
						},
						body: { password: "${secrets[2]}" },
					},
					auth: {
						accessToken: "${secrets[3]}",
						credentials: { apiKey: "${secrets[4]}" },
					},
				});
				logger.error("credential failure", new Error("failed: ${secrets[5]}"));
			});
			process.stderr.write(JSON.stringify(emitted));
		`);

		expect(result.exitCode).toBe(0);
		for (const secret of secrets) {
			expect(result.stderr).not.toContain(secret);
		}
	});
});

interface RecordedSpan {
	attributes: Record<string, ObservabilityAttributeValue>;
}

function recordingObservability() {
	const spans: RecordedSpan[] = [];
	const adapter: ObservabilityAdapter = {
		tracer: () => ({
			startActiveSpan: (_name, _options, fn) => {
				const recorded: RecordedSpan = { attributes: {} };
				spans.push(recorded);
				const span: ObservabilitySpan = {
					setAttribute: (key, value) => {
						recorded.attributes[key] = value;
					},
					setAttributes: (attributes) => {
						for (const [key, value] of Object.entries(attributes)) {
							if (value !== undefined) recorded.attributes[key] = value;
						}
					},
					recordError: () => {},
					addEvent: () => {},
					end: () => {},
				};
				return fn(span);
			},
		}),
		meter: () => ({
			createCounter: () => ({ add: () => {} }),
			createHistogram: () => ({ record: () => {} }),
		}),
		shutdown: async () => {},
	};
	return { adapter, spans };
}

const correlation = route()
	.get()
	.outputSchema(
		z.object({
			requestId: z.string(),
			traceId: z.string(),
		}),
	)
	.handler(async ({ requestId, traceId }) => ({ requestId, traceId }));

describe("untrusted inbound correlation identifiers", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let spans: RecordedSpan[];

	afterEach(async () => {
		await setup?.cleanup();
	});

	async function request(headers: Record<string, string>) {
		const recorded = recordingObservability();
		spans = recorded.spans;
		setup = await buildMockApp({ routes: { correlation } });
		setup.app.config.observability = { adapter: recorded.adapter };
		setup.app.observability = new ObservabilityService({
			adapter: recorded.adapter,
		});

		const handler = createFetchHandler(setup.app);
		const response = await handler(
			new Request("http://localhost/correlation", { headers }),
		);
		const body = (await response?.json()) as {
			requestId: string;
			traceId: string;
		};
		const log = setup.app.mocks.logger
			.getLogsContaining("HTTP request completed")
			.at(-1);
		return { response: response!, body, log, span: spans[0]! };
	}

	function serializeCorrelation(
		observed: Awaited<ReturnType<typeof request>>,
	): string {
		return JSON.stringify({
			body: observed.body,
			responseHeaders: {
				requestId: observed.response.headers.get("x-request-id"),
				traceId: observed.response.headers.get("x-trace-id"),
			},
			log: observed.log?.args,
			span: observed.span,
		});
	}

	it("F01 preserves valid identifiers across context, headers, logs, and spans", async () => {
		const requestId = "req_valid-123";
		const traceId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
		const observed = await request({
			"x-request-id": requestId,
			traceparent: `00-${traceId}-bbbbbbbbbbbbbbbb-01`,
		});

		expect(observed.body).toEqual({ requestId, traceId });
		expect(observed.response.headers.get("x-request-id")).toBe(requestId);
		expect(observed.response.headers.get("x-trace-id")).toBe(traceId);
		expect(observed.log?.args[0]).toMatchObject({ requestId, traceId });
		expect(observed.span.attributes).toMatchObject({
			"questpie.request_id": requestId,
			"questpie.trace_id": traceId,
		});
	});

	it("F02 replaces malformed identifiers without reflecting hostile values", async () => {
		const requestId = "../../logs?token=HOSTILE_REQUEST_ID";
		const traceId = "not-a-trace/HOSTILE_TRACE_ID";
		const observed = await request({
			"x-request-id": requestId,
			"x-trace-id": traceId,
		});

		expect(observed.body.requestId).toMatch(SAFE_CORRELATION_ID);
		expect(observed.body.traceId).toMatch(SAFE_CORRELATION_ID);
		expect(observed.response.headers.get("x-request-id")).toMatch(
			SAFE_CORRELATION_ID,
		);
		expect(observed.response.headers.get("x-trace-id")).toMatch(
			SAFE_CORRELATION_ID,
		);
		expect(serializeCorrelation(observed)).not.toContain("HOSTILE_REQUEST_ID");
		expect(serializeCorrelation(observed)).not.toContain("HOSTILE_TRACE_ID");
	});

	it("F02 replaces oversized identifiers without reflecting hostile values", async () => {
		const requestId = `${"r".repeat(512)}HOSTILE_OVERSIZED_REQUEST`;
		const traceId = `${"t".repeat(512)}HOSTILE_OVERSIZED_TRACE`;
		const observed = await request({
			"x-correlation-id": requestId,
			"x-trace-id": traceId,
		});

		expect(observed.body.requestId).toMatch(SAFE_CORRELATION_ID);
		expect(observed.body.traceId).toMatch(SAFE_CORRELATION_ID);
		expect(observed.response.headers.get("x-request-id")).toMatch(
			SAFE_CORRELATION_ID,
		);
		expect(observed.response.headers.get("x-trace-id")).toMatch(
			SAFE_CORRELATION_ID,
		);
		expect(serializeCorrelation(observed)).not.toContain(
			"HOSTILE_OVERSIZED_REQUEST",
		);
		expect(serializeCorrelation(observed)).not.toContain(
			"HOSTILE_OVERSIZED_TRACE",
		);
	});
});
