import { saasApp } from "./saas-app.js";
const app = await saasApp();
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	idleTimeout: 0,
	fetch: app.handler,
});
process.send?.({ ready: true, url: server.url.toString(), pid: process.pid });
process.on(
	"message",
	async (message: { operation: string; request: string }) => {
		if (message.operation === "stats")
			process.send?.({ request: message.request, ...app.stats() });
		if (message.operation === "stop") {
			await server.stop(true);
			await app.cleanup();
			process.send?.({ request: message.request });
			process.exit(0);
		}
	},
);
