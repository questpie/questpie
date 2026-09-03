import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createOfficialQuestpieObservability } from "questpie/internal/observability";

import { createApp } from "../.questpie/generated/app";
import { demoSessionCookieName, demoSessionToken } from "../src/route-auth";

const root = resolve(import.meta.dir, "..");
const databaseUrl =
	process.env.DATABASE_URL ??
	(() => {
		throw new TypeError("DATABASE_URL is required");
	})();
const portArgument = Bun.argv.find((argument) =>
	argument.startsWith("--port="),
);
const portValue =
	portArgument?.slice("--port=".length) ?? process.env.PORT ?? "0";
if (portValue.trim().length === 0)
	throw new TypeError("port must be an integer between 0 and 65535");
const port = Number(portValue);
if (!Number.isSafeInteger(port) || port < 0 || port > 65_535)
	throw new TypeError("port must be an integer between 0 and 65535");

const [html, styles, browserBuild] = await Promise.all([
	readFile(resolve(import.meta.dir, "index.html"), "utf8"),
	readFile(resolve(import.meta.dir, "styles.css"), "utf8"),
	Bun.build({
		entrypoints: [resolve(import.meta.dir, "client.ts")],
		format: "esm",
		minify: true,
		target: "browser",
	}),
]);
if (!browserBuild.success)
	throw new Error(browserBuild.logs.map((entry) => entry.message).join("\n"));
const browserJavaScript = await browserBuild.outputs[0]!.text();
const observationForbiddenValues = [
	"hidden-",
	"40000000-0000-4000-8000-",
	"00000000-0000-4000-8000-000000000075",
	"collaboration.messages",
	"messages_unavailable",
	"policyEvidencePoint",
	'"hiddenCardinality":50',
	'"hiddenCount":50',
	'"rowCount":50',
	"PostgreSQL",
	"SELECT ",
	"select ",
	"selectOrdinal",
	"forgedOrdinal",
] as const;
const inverseRuntimeEvidence = {
	failedRecomputations: 0,
	inverseObservationNondisclosure: true,
};
function inspectInverseObservation(value: unknown): void {
	const bytes = JSON.stringify(value);
	if (observationForbiddenValues.some((secret) => bytes.includes(secret)))
		inverseRuntimeEvidence.inverseObservationNondisclosure = false;
}
const observability = createOfficialQuestpieObservability(() => ({
	format: "questpie.runtime-observability",
	version: 1,
	extract: () => null,
	begin: (start: Readonly<Record<string, unknown>>) => {
		const inverseRecompute =
			start.kind === "query" &&
			start.entry === "watch_recompute" &&
			start.resourceIdentity === "query:channels.detail";
		if (inverseRecompute) inspectInverseObservation(start);
		return {
			context: null,
			run: async <Result>(use: () => Result | Promise<Result>) => await use(),
			event: (event: unknown) => {
				if (inverseRecompute) inspectInverseObservation(event);
			},
			end: (end: Readonly<{ outcome: string }>) => {
				if (inverseRecompute) inspectInverseObservation(end);
				if (inverseRecompute && end.outcome === "framework_error")
					inverseRuntimeEvidence.failedRecomputations += 1;
			},
		};
	},
}));
const application = await createApp({
	postgres: { connectionUrl: databaseUrl, directConnectionUrl: databaseUrl },
	realtime: { hmacKey: new Uint8Array(32).fill(23) },
	maintenance: { authorize: () => false },
	observability,
});
let report: Readonly<Record<string, unknown>> = Object.freeze({
	phase: "host-ready",
	connections: 0,
});
const reportHistory: Readonly<Record<string, unknown>>[] = [];
let completeRecovery!: () => void;
const recoveryCompletion = new Promise<void>((resolveCompletion) => {
	completeRecovery = resolveCompletion;
});

const response = (body: BodyInit, contentType: string) =>
	new Response(body, { headers: { "content-type": contentType } });

const server = Bun.serve({
	port,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/") {
			const headers = new Headers({
				"content-type": "text/html; charset=utf-8",
			});
			if (
				request.method === "GET" &&
				url.searchParams.get("credential") === "demo-cookie"
			) {
				headers.set(
					"set-cookie",
					`${demoSessionCookieName}=${demoSessionToken}; Path=/; HttpOnly; SameSite=Strict`,
				);
			}
			return new Response(html, { headers });
		}
		if (url.pathname === "/styles.css")
			return response(styles, "text/css; charset=utf-8");
		if (url.pathname === "/tracer.js")
			return response(browserJavaScript, "text/javascript; charset=utf-8");
		if (
			request.method === "GET" &&
			url.pathname === "/__questpie_tracer/sign-in"
		) {
			const returnTo = url.searchParams.get("return");
			if (!returnTo || !returnTo.startsWith("/") || returnTo.startsWith("//"))
				return new Response(null, { status: 400 });
			const destination = new URL(returnTo, url);
			if (destination.origin !== url.origin)
				return new Response(null, { status: 400 });
			return new Response(null, {
				status: 303,
				headers: {
					location: `${destination.pathname}${destination.search}${destination.hash}`,
					"set-cookie": `${demoSessionCookieName}=${demoSessionToken}; Path=/; HttpOnly; SameSite=Strict`,
				},
			});
		}
		if (
			request.method === "POST" &&
			url.pathname === "/__questpie_tracer/sign-out"
		)
			return new Response(null, {
				status: 204,
				headers: {
					"set-cookie": `${demoSessionCookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`,
				},
			});
		if (url.pathname === "/__questpie_tracer/report") {
			if (request.method === "POST") {
				let body: unknown;
				try {
					body = await request.json();
				} catch {
					return new Response(null, { status: 400 });
				}
				if (!body || typeof body !== "object" || Array.isArray(body))
					return new Response(null, { status: 400 });
				const event = Object.freeze({ ...(body as Record<string, unknown>) });
				reportHistory.push(event);
				report = Object.freeze({ ...event, history: [...reportHistory] });
				return new Response(null, { status: 204 });
			}
			return Response.json({
				...report,
				inverseRuntime: inverseRuntimeEvidence,
			});
		}
		if (
			request.method === "GET" &&
			url.pathname === "/__questpie_tracer/complete-recovery"
		) {
			await recoveryCompletion;
			return new Response(null, { status: 204 });
		}
		if (
			request.method === "POST" &&
			url.pathname === "/__questpie_tracer/complete-recovery"
		) {
			completeRecovery();
			return new Response(null, { status: 204 });
		}
		return application.fetch(request);
	},
});

let stopping = false;
// The collaboration product tracer owns these bounded lease controls so its
// crash/reclaim oracle does not depend on production defaults or wall-clock luck.
function workerInteger(name: string): number | undefined {
	const raw = process.env[name];
	if (raw === undefined) return undefined;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new TypeError(`${name} must be a positive integer`);
	return value;
}
const leaseMilliseconds = workerInteger(
	"QUESTPIE_TRACER_WORKER_LEASE_MILLISECONDS",
);
const heartbeatMilliseconds = workerInteger(
	"QUESTPIE_TRACER_WORKER_HEARTBEAT_MILLISECONDS",
);
const attemptDeadlineMilliseconds = workerInteger(
	"QUESTPIE_TRACER_WORKER_ATTEMPT_DEADLINE_MILLISECONDS",
);
const worker = application.durable.worker({
	workerId: `collaboration-tracer:${process.pid}`,
	...(leaseMilliseconds === undefined ? {} : { leaseMilliseconds }),
	...(heartbeatMilliseconds === undefined ? {} : { heartbeatMilliseconds }),
	...(attemptDeadlineMilliseconds === undefined
		? {}
		: { attemptDeadlineMilliseconds }),
});
console.log(JSON.stringify({ event: "ready", port: server.port, root }));
const workerLoop =
	process.env.QUESTPIE_TRACER_PAUSE_WORKER === "1"
		? Promise.resolve()
		: (async () => {
				for (;;) {
					if (stopping) break;
					await worker.poll();
					await Bun.sleep(50);
				}
			})();

async function close(): Promise<void> {
	if (stopping) return;
	stopping = true;
	worker.beginDrain();
	server.stop(false);
	await workerLoop;
	await application.close();
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
