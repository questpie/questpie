import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createApp } from "../.questpie/generated/app";

const root = resolve(import.meta.dir, "..");

function portFromArguments(): number {
	const argument = Bun.argv.find((candidate) =>
		candidate.startsWith("--port="),
	);
	const raw = argument?.slice("--port=".length) ?? process.env.PORT ?? "0";
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value < 0 || value > 65_535)
		throw new TypeError("port must be an integer between 0 and 65535");
	return value;
}

function workerInteger(name: string): number | undefined {
	const raw = process.env[name];
	if (raw === undefined) return undefined;
	const value = Number(raw);
	if (!Number.isSafeInteger(value) || value <= 0)
		throw new TypeError(`${name} must be a positive integer`);
	return value;
}

type ReceiverReceipt = Readonly<{
	body: unknown;
	headers: Readonly<Record<string, string>>;
	receivedAt: string;
}>;
const receiverReceipts: ReceiverReceipt[] = [];
let rejectNextReceiverRequest = false;
const receiver = Bun.serve({
	hostname: "127.0.0.1",
	port: 43_121,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/team-support/notifications") {
			if (request.method !== "POST")
				return new Response(null, { status: 405, headers: { allow: "POST" } });
			if (rejectNextReceiverRequest) {
				rejectNextReceiverRequest = false;
				return Response.json({ code: "PROVIDER_REJECTED" }, { status: 503 });
			}
			const receipt = Object.freeze({
				body: await request.json(),
				headers: Object.freeze(Object.fromEntries(request.headers)),
				receivedAt: new Date().toISOString(),
			});
			receiverReceipts.push(receipt);
			return new Response(null, {
				status: 202,
				headers: {
					"x-team-support-receipt": `receiver:${receiverReceipts.length}`,
				},
			});
		}
		if (url.pathname === "/__receipts" && request.method === "GET")
			return Response.json({ receipts: receiverReceipts });
		if (url.pathname === "/__reject-next" && request.method === "POST") {
			rejectNextReceiverRequest = true;
			return new Response(null, { status: 204 });
		}
		return new Response(null, { status: 404 });
	},
});

const databaseUrl =
	process.env.DATABASE_URL ??
	(() => {
		throw new TypeError("DATABASE_URL is required");
	})();
const [html, styles, browserBuild] = await Promise.all([
	readFile(resolve(import.meta.dir, "index.html"), "utf8"),
	readFile(resolve(import.meta.dir, "styles.css"), "utf8"),
	Bun.build({
		entrypoints: [resolve(import.meta.dir, "browser/main.tsx")],
		format: "esm",
		minify: true,
		target: "browser",
	}),
]);
if (!browserBuild.success)
	throw new Error(browserBuild.logs.map(({ message }) => message).join("\n"));
if (browserBuild.outputs.length !== 1)
	throw new TypeError("Team Support Desk must compile to one browser bundle");
const browserJavaScript = await browserBuild.outputs[0]!.text();
const application = await createApp({
	postgres: { connectionUrl: databaseUrl, directConnectionUrl: databaseUrl },
	realtime: { hmacKey: new Uint8Array(32).fill(41) },
	maintenance: { authorize: () => true },
});

let latestReport: Readonly<Record<string, unknown>> = Object.freeze({
	phase: "host-ready",
});
const response = (body: BodyInit, contentType: string) =>
	new Response(body, {
		headers: {
			"cache-control": "no-store",
			"content-type": contentType,
		},
	});
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: portFromArguments(),
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/" && request.method === "GET")
			return response(html, "text/html; charset=utf-8");
		if (url.pathname === "/styles.css" && request.method === "GET")
			return response(styles, "text/css; charset=utf-8");
		if (url.pathname === "/desk.js" && request.method === "GET")
			return response(browserJavaScript, "text/javascript; charset=utf-8");
		if (url.pathname === "/__team_support/report") {
			if (request.method === "GET") return Response.json(latestReport);
			if (request.method === "POST") {
				const body = await request.json();
				if (!body || typeof body !== "object" || Array.isArray(body))
					return new Response(null, { status: 400 });
				latestReport = Object.freeze({ ...(body as Record<string, unknown>) });
				return new Response(null, { status: 204 });
			}
			return new Response(null, { status: 405 });
		}
		return application.fetch(request);
	},
});

let stopping = false;
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
	workerId: `team-support-tracer:${process.pid}`,
	...(leaseMilliseconds === undefined ? {} : { leaseMilliseconds }),
	...(heartbeatMilliseconds === undefined ? {} : { heartbeatMilliseconds }),
	...(attemptDeadlineMilliseconds === undefined
		? {}
		: { attemptDeadlineMilliseconds }),
});
const workerLoop =
	process.env.QUESTPIE_TRACER_PAUSE_WORKER === "1"
		? Promise.resolve()
		: (async () => {
				for (;;) {
					if (stopping) break;
					await worker.poll();
					await Bun.sleep(40);
				}
			})();
console.log(
	JSON.stringify({
		event: "ready",
		port: server.port,
		receiverPort: receiver.port,
		root,
	}),
);

async function close(): Promise<void> {
	if (stopping) return;
	stopping = true;
	worker.beginDrain();
	server.stop(false);
	receiver.stop(false);
	await workerLoop;
	await application.close();
}
process.once("SIGINT", () => void close());
process.once("SIGTERM", () => void close());
