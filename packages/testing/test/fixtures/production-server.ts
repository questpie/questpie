const port = Number(process.env.PORT);
const mode = process.env.HARNESS_MODE ?? "ready";
const printedSecret = process.env.PRINT_SECRET ?? "";

if (printedSecret) console.log(`boot secret=${printedSecret}`);

if (mode === "early-exit") {
	console.error(`fixture failed secret=${printedSecret}`);
	process.exit(7);
}

if (mode === "noisy") {
	for (let index = 0; index < 20; index += 1) {
		console.log(`noise-${index}`);
	}
}

const server = Bun.serve({
	hostname: "127.0.0.1",
	port,
	fetch(request) {
		const url = new URL(request.url);
		if (url.pathname === "/health") {
			return new Response(mode === "never-ready" ? "starting" : "ok", {
				status: mode === "never-ready" ? 503 : 200,
			});
		}
		if (url.pathname === "/identity") {
			return Response.json({
				pid: process.pid,
				databaseUrl: process.env.DATABASE_URL,
				appUrl: process.env.APP_URL,
				parentLeak: process.env.QP_PARENT_LEAK,
			});
		}
		return new Response("not found", { status: 404 });
	},
});

if (mode === "ignore-term") {
	process.on("SIGTERM", () => {
		console.log("ignored SIGTERM");
	});
} else {
	process.on("SIGTERM", () => {
		server.stop(true);
		process.exit(0);
	});
}

console.log(`ready pid=${process.pid} port=${server.port}`);
