import { runMigrations, type WorkerPool } from "graphile-worker";
import pg from "pg";

import { GraphileWorkerAdapter } from "../../../src/exports/adapters/graphile-worker.js";

const url = process.env.QUESTPIE_GRAPHILE_CRASH_URL!;
const adapter = new GraphileWorkerAdapter({
	connectionString: url,
	schema: process.env.QUESTPIE_GRAPHILE_CRASH_SCHEMA!,
});
const internal = adapter as unknown as {
	runner: WorkerPool;
	executionClient: pg.Client;
	listening: boolean;
	recoveryTimer: ReturnType<typeof setTimeout>;
	scheduleTimer: ReturnType<typeof setTimeout>;
};
adapter.on("error", () => {
	process.stdout.write(
		`stopped:${internal.listening}:${internal.recoveryTimer.hasRef()}\n`,
	);
});
const mode = process.env.QUESTPIE_GRAPHILE_DEATH_MODE;
let entered = false;
if (mode === "shutdown-fence" || mode === "fence")
	await adapter.publish("death", {});
await adapter.listen({
	death: async () => {
		entered = true;
		if (mode === "shutdown-fence" || mode === "fence")
			await new Promise<void>(() => {});
	},
});
if (mode === "shutdown-fence" || mode === "fence") {
	for (;;) {
		if (entered) break;
		await Bun.sleep(1);
	}
	if (mode === "shutdown-fence") void adapter.stop();
}
// Simulate a web server keeping an otherwise dead worker pod alive.
const interval = setInterval(() => {}, 1000);
const client = new pg.Client({ connectionString: url });
await client.connect();
if (mode === "foreign-migration") {
	const schema = process.env.QUESTPIE_GRAPHILE_CRASH_SCHEMA! + "_other";
	await runMigrations({ connectionString: url, schema });
	await Bun.sleep(200);
	await adapter.publish("death", {});
	for (;;) {
		if (entered) break;
		await Bun.sleep(1);
	}
	console.log("foreign-migration:healthy");
	await adapter.stop();
	await client.query(`DROP SCHEMA "${schema}" CASCADE`);
	await client.end();
	clearInterval(interval);
} else if (mode === "migration") {
	await client.query(
		`INSERT INTO "${process.env.QUESTPIE_GRAPHILE_CRASH_SCHEMA!}".migrations (id,breaking) VALUES (999,true)`,
	);
	await client.query(`NOTIFY "worker:migrate", '{"breaking":true}'`);
} else if (mode === "fence" || mode === "shutdown-fence") {
	const result = await internal.executionClient.query(
		"SELECT pg_backend_pid() AS pid",
	);
	await client.query("SELECT pg_terminate_backend($1)", [result.rows[0].pid]);
} else {
	await internal.runner.gracefulShutdown();
}

// Bun must also terminate while an entry module awaits an unresolved promise.
if (mode !== "foreign-migration") await new Promise<void>(() => {});
