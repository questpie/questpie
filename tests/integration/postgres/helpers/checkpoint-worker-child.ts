import { pathToFileURL } from "node:url";

// Test-owned process. Credentials stay in inherited environment, never argv.
const modulePath = process.argv[2];
if (!modulePath) throw new Error("generated application path is required");
const url = new URL("postgres://localhost/");
url.hostname = process.env.PGHOST ?? "127.0.0.1";
url.port = process.env.PGPORT ?? "5432";
url.username = process.env.PGUSER ?? "postgres";
if (process.env.PGPASSWORD) url.password = process.env.PGPASSWORD;
url.pathname = `/${process.env.PGDATABASE}`;
try {
	const internal = await import(pathToFileURL(modulePath).href);
	const app = await internal.createApplication({
		postgres: {
			connectionUrl: url.toString(),
			directConnectionUrl: url.toString(),
		},
		realtime: { hmacKey: new Uint8Array(32).fill(47) },
		maintenance: { authorize: () => false },
	});
	try {
		process.stdout.write("checkpoint-worker-ready\n");
		if ((await Bun.stdin.text()).trim() !== "start")
			throw new Error("worker start handshake is required");
		await app.durable
			.worker({
				workerId: "crash-checkpoint-worker",
				claimBatch: 1,
				leaseMilliseconds: 1000,
				heartbeatMilliseconds: 100,
			})
			.poll();
		process.stdout.write("checkpoint-worker-settled\n");
	} finally {
		await app.close();
	}
} catch {
	process.stderr.write("checkpoint-worker-failed\n");
	process.exitCode = 1;
}
