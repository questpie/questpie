import type { WorkerPool } from "graphile-worker";
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
if (mode === "shutdown-fence") await adapter.publish("death", {});
await adapter.listen({
	death: async () => {
		entered = true;
		if (mode === "shutdown-fence") await new Promise<void>(() => {});
	},
});
if (mode === "shutdown-fence") {
	while (!entered) await Bun.sleep(1);
	void adapter.stop();
}
// Simulate a web server keeping an otherwise dead worker pod alive.
setInterval(() => {}, 1000);
const client = new pg.Client({ connectionString: url });
await client.connect();
if (mode === "migration") {
	await client.query(`NOTIFY "worker:migrate", '{"breaking":true}'`);
} else if (mode === "fence" || mode === "shutdown-fence") {
	const result = await internal.executionClient.query(
		"SELECT pg_backend_pid() AS pid",
	);
	await client.query("SELECT pg_terminate_backend($1)", [result.rows[0].pid]);
} else {
	await internal.runner.gracefulShutdown();
}
