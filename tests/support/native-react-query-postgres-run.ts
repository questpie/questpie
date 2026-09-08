import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const owner = `questpie-native-query-${crypto.randomUUID()}`;
const temporary = await mkdtemp(join(tmpdir(), "questpie-native-query-"));
let container: string | undefined;
function docker(...args: string[]) {
	const result = Bun.spawnSync(["docker", ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	if (result.exitCode !== 0)
		throw new Error(`Disposable PostgreSQL command failed: ${args[0]}`);
	return result.stdout.toString().trim();
}
try {
	container = docker(
		"run",
		"--detach",
		"--rm",
		"--name",
		owner,
		"--publish",
		"127.0.0.1::5432",
		"--env",
		"POSTGRES_HOST_AUTH_METHOD=trust",
		"--env",
		"POSTGRES_DB=collaboration_native",
		"--env",
		"POSTGRES_INITDB_ARGS=--encoding=UTF8 --lc-collate=C.UTF-8 --lc-ctype=C.UTF-8",
		"postgres:17",
	);
	if (!/^[a-f0-9]{64}$/.test(container))
		throw new Error("Invalid owned container identity");
	const binding = docker("port", container, "5432/tcp");
	const port = /^127\.0\.0\.1:(\d+)$/.exec(binding)?.[1];
	if (!port || Number(port) < 1 || Number(port) > 65535)
		throw new Error("PostgreSQL is not loopback-bound");
	for (let attempt = 0; ; attempt++) {
		const ready = Bun.spawnSync([
			"docker",
			"exec",
			container,
			"pg_isready",
			"-h",
			"127.0.0.1",
			"-U",
			"postgres",
			"-d",
			"collaboration_native",
		]);
		if (ready.exitCode === 0) break;
		if (attempt === 60)
			throw new Error("Owned PostgreSQL did not become ready");
		await Bun.sleep(250);
	}
	const environment = { ...process.env };
	for (const name of Object.keys(environment))
		if (
			name.startsWith("PG") ||
			name === "DATABASE_URL" ||
			name === "SQL_DATABASE_URL" ||
			name === "QUESTPIE_PACKED_TARBALL"
		)
			delete environment[name];
	const child = Bun.spawn(
		[
			"bun",
			"test",
			join(
				import.meta.dir,
				"../integration/postgres/native-react-query.test.ts",
			),
			"--timeout",
			"180000",
		],
		{
			cwd: import.meta.dir,
			env: {
				...environment,
				TMPDIR: temporary,
				PGHOST: "127.0.0.1",
				PGPORT: port,
				PGUSER: "postgres",
				PGDATABASE: "collaboration_native",
				QUESTPIE_NATIVE_QUERY_CONTAINER: container,
			},
			stdout: "inherit",
			stderr: "inherit",
		},
	);
	process.exitCode = await child.exited;
} finally {
	try {
		if (container && /^[a-f0-9]{64}$/.test(container))
			docker("rm", "--force", container);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}
