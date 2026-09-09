import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
	nativePostgresEnvironment,
	requireFreeDeskPorts,
	selectNativePostgresTarget,
} from "../support/native-react-query-postgres-run";

const runner = resolve(
	import.meta.dir,
	"../support/native-react-query-postgres-run.ts",
);

test("the owned PostgreSQL runner selects only Collaboration or the golden Desk file", () => {
	expect(selectNativePostgresTarget([])).toEqual({
		kind: "collaboration",
		database: "collaboration_native",
		test: "native-react-query.test.ts",
		ports: [],
	});
	expect(selectNativePostgresTarget(["desk"])).toEqual({
		kind: "desk",
		database: "team_support_desk_native",
		test: "team-support-desk.test.ts",
		ports: [43121],
	});
	for (const args of [["unknown"], ["desk", "extra"], ["../other.test.ts"]])
		expect(() => selectNativePostgresTarget(args)).toThrow(
			"Expected no arguments or desk",
		);
});

test("Desk process inputs cannot inherit a database, packed override, telemetry exporter or Auth configuration", () => {
	const discarded = [
		"PGHOST",
		"PGPASSWORD",
		"DATABASE_URL",
		"SQL_DATABASE_URL",
		"QUESTPIE_PACKED_TARBALL",
		"QUESTPIE_OTEL_PACKED_TARBALL",
		"QUESTPIE_TRACER_PAUSE_WORKER",
		"OTEL_EXPORTER_OTLP_ENDPOINT",
		"OTEL_EXPORTER_OTLP_HEADERS",
		"BETTER_AUTH_SECRET",
		"BETTER_AUTH_TRUSTED_HOST",
	];
	const input = {
		...Object.fromEntries(
			discarded.map((name) => [name, "synthetic-override"]),
		),
		PATH: "/synthetic-bin",
		FIREFOX_BIN: "/synthetic-firefox",
		TMPDIR: "/synthetic-temp",
	};
	expect(nativePostgresEnvironment(input, "desk")).toEqual({
		PATH: "/synthetic-bin",
		FIREFOX_BIN: "/synthetic-firefox",
		TMPDIR: "/synthetic-temp",
	});
	expect(Object.keys(input)).toHaveLength(discarded.length + 3);
	expect(
		nativePostgresEnvironment(input, "collaboration")[
			"OTEL_EXPORTER_OTLP_ENDPOINT"
		],
	).toBe("synthetic-override");
});

test("Desk port preflight refuses an occupied port without stopping its owner", async () => {
	const existing = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch: () => new Response("Existing owner remains active"),
	});
	try {
		await expect(requireFreeDeskPorts([existing.port!])).rejects.toThrow(
			"existing services were not changed",
		);
		expect(await (await fetch(existing.url)).text()).toBe(
			"Existing owner remains active",
		);
	} finally {
		await existing.stop(true);
	}
});

test("the owned PostgreSQL runner rejects unknown selections before Docker or scratch creation", async () => {
	const temporary = await mkdtemp(join(tmpdir(), "questpie-runner-control-"));
	try {
		await writeFile(
			join(temporary, "docker"),
			"#!/bin/sh\nprintf 'DOCKER_REACHED\\n' > docker-reached\nexit 87\n",
			{ mode: 0o755 },
		);
		const child = Bun.spawn([process.execPath, runner, "unknown"], {
			cwd: temporary,
			// No Docker executable can run in this argument-validation control.
			env: { ...process.env, PATH: temporary, TMPDIR: temporary },
			stdout: "pipe",
			stderr: "pipe",
			timeout: 2_000,
		});
		const [exit, stdout, stderr] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
		]);
		expect(exit).not.toBe(0);
		expect(stdout + stderr).toContain("Expected no arguments or desk");
		expect(stdout + stderr).not.toContain("DOCKER_REACHED");
		expect(await readdir(temporary)).toEqual(["docker"]);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
});
