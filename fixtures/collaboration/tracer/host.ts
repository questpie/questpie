import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { principal } from "questpie";

import { createApp } from "../.questpie/generated/app";
import { bindIngressPrincipalForRequest } from "../.questpie/generated/internal/application.js";
import { tracerIds } from "./constants";

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
const application = await createApp({
	postgres: { connectionUrl: databaseUrl, directConnectionUrl: databaseUrl },
	realtime: { hmacKey: new Uint8Array(32).fill(23) },
	maintenance: { authorize: () => false },
});
const demoPrincipal = principal.user({ id: tracerIds.principal });
let report: Readonly<Record<string, unknown>> = Object.freeze({
	phase: "host-ready",
	connections: 0,
});

const response = (body: BodyInit, contentType: string) =>
	new Response(body, { headers: { "content-type": contentType } });
const server = Bun.serve({
	port,
	async fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/") return response(html, "text/html; charset=utf-8");
		if (url.pathname === "/styles.css")
			return response(styles, "text/css; charset=utf-8");
		if (url.pathname === "/tracer.js")
			return response(browserJavaScript, "text/javascript; charset=utf-8");
		if (url.pathname === "/__questpie_tracer/report") {
			if (request.method === "POST") {
				const body = await request.json();
				if (!body || typeof body !== "object" || Array.isArray(body))
					return new Response(null, { status: 400 });
				report = Object.freeze({ ...(body as Record<string, unknown>) });
				return new Response(null, { status: 204 });
			}
			return Response.json(report);
		}
		if (url.pathname.startsWith("/_questpie/"))
			return application.fetch(
				bindIngressPrincipalForRequest(request, demoPrincipal),
			);
		return new Response("Not found", { status: 404 });
	},
});

let stopping = false;
const worker = application.durable.worker({
	workerId: `collaboration-tracer:${process.pid}`,
});
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
console.log(JSON.stringify({ event: "ready", port: server.port, root }));
