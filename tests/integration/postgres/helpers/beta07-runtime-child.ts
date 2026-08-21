import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

type TimerCallback = (...arguments_: readonly unknown[]) => void;

const [generatedRoot, postgresUrl, principalId] = process.argv.slice(2);
if (!generatedRoot || !postgresUrl || !principalId)
	throw new Error("BETA-07 child Runtime arguments are missing");

const scanCallbacks: TimerCallback[] = [];
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
globalThis.setInterval = ((
	callback: TimerCallback,
	milliseconds?: number,
	...arguments_: readonly unknown[]
) => {
	if (milliseconds !== 10_000)
		return originalSetInterval(
			callback as (...values: unknown[]) => void,
			milliseconds,
			...arguments_,
		);
	const handle = { unref() {} };
	scanCallbacks.push(() => callback(...arguments_));
	return handle as never;
}) as typeof globalThis.setInterval;
globalThis.clearInterval = ((handle: unknown) => {
	if (typeof handle === "object" && handle !== null && "unref" in handle)
		return;
	originalClearInterval(handle as never);
}) as typeof globalThis.clearInterval;

const nonce = `?beta07-child=${crypto.randomUUID()}`;
const internal = (await import(
	`${pathToFileURL(resolve(generatedRoot, "internal/application.js")).href}${nonce}`
)) as Readonly<{
	createApplication(
		input: Readonly<{
			postgres: Readonly<{ url: string }>;
			realtime: Readonly<{ hmacKey: Uint8Array }>;
			maintenance: Readonly<{ authorize(): boolean }>;
		}>,
	): Promise<Readonly<{ fetch(request: Request): Promise<Response> }>>;
	bindIngressPrincipalForRequest(request: Request, principal: unknown): Request;
}>;
const framework = (await import(
	`${pathToFileURL(resolve(generatedRoot, "../../node_modules/questpie/index.ts")).href}${nonce}`
)) as Readonly<{
	principal: Readonly<{ user(input: Readonly<{ id: string }>): unknown }>;
}>;
const principal = framework.principal.user({ id: principalId });
const application = await internal.createApplication({
	postgres: { connectionUrl: postgresUrl, directConnectionUrl: postgresUrl },
	realtime: { hmacKey: new Uint8Array(32).fill(7) },
	maintenance: { authorize: () => true },
});

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	async fetch(request) {
		if (new URL(request.url).pathname === "/__questpie_test/scan") {
			for (const callback of scanCallbacks) callback();
			return new Response(null, { status: 204 });
		}
		return application.fetch(
			internal.bindIngressPrincipalForRequest(request, principal),
		);
	},
});

process.stdout.write(`${JSON.stringify({ port: server.port })}\n`);
