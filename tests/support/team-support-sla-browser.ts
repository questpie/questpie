import { expect } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { eventually } from "../../packages/testkit/src";

const fixture = resolve(import.meta.dir, "../../fixtures/team-support-desk");

/** Uses the fixture's real React detail and Better Auth session in Firefox. */
export async function startTeamSlaBrowser(input: {
	ticketId: string;
	fetch(request: Request): Promise<Response>;
}) {
	for (const name of ["auth:migrate", "auth:seed"]) {
		const result = Bun.spawnSync(["bun", "run", name], {
			cwd: fixture,
			env: process.env,
			stdout: "pipe",
			stderr: "pipe",
		});
		expect(result.exitCode, `${name} failed`).toBe(0);
	}
	const build = await Bun.build({
		entrypoints: [join(fixture, "tracer/browser/main.tsx")],
		target: "browser",
		format: "esm",
		minify: true,
	});
	expect(build.success).toBe(true);
	expect(build.outputs).toHaveLength(1);
	const [html, styles, javascript] = await Promise.all([
		readFile(join(fixture, "web/index.html"), "utf8"),
		readFile(join(fixture, "web/styles.css"), "utf8"),
		build.outputs[0]!.text(),
	]);
	let report: Record<string, unknown> = {};
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		idleTimeout: 120,
		async fetch(request) {
			const path = new URL(request.url).pathname;
			if (path === "/")
				return new Response(html, { headers: { "content-type": "text/html" } });
			if (path === "/styles.css")
				return new Response(styles, {
					headers: { "content-type": "text/css" },
				});
			if (path === "/desk.js")
				return new Response(javascript, {
					headers: { "content-type": "application/javascript" },
				});
			if (path === "/__team_support/report" && request.method === "POST") {
				report = (await request.json()) as Record<string, unknown>;
				return new Response(null, { status: 204 });
			}
			return input.fetch(request);
		},
	});
	const profile = await mkdtemp(join(tmpdir(), "questpie-team-sla-firefox-"));
	const url = new URL(`http://127.0.0.1:${server.port}/`);
	url.searchParams.set("tracerPersona", "agent");
	url.searchParams.set("tracerSlaTicket", input.ticketId);
	const browser = Bun.spawn(
		[
			process.env.FIREFOX_BIN ?? "/usr/bin/firefox",
			"--headless",
			"--no-remote",
			"--profile",
			profile,
			url.toString(),
		],
		{
			env: { ...process.env, MOZ_HEADLESS: "1" },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
		},
	);
	return {
		phase: (phase: string) =>
			eventually(() => report, {
				accept: (value) => {
					if (value.phase === "desk-error")
						throw new Error(`Firefox tracer failed: ${String(value.error)}`);
					return value.phase === phase;
				},
				timeoutMilliseconds: 30_000,
				description: `Firefox ${phase}`,
			}),
		close: async () => {
			browser.kill("SIGTERM");
			await browser.exited;
			server.stop(true);
			await rm(profile, { recursive: true, force: true });
		},
	};
}
