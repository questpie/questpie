import { expect, test } from "bun:test";
import {
	mkdir,
	mkdtemp,
	readFile,
	readdir,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { SQL } from "bun";

const repository = resolve(import.meta.dir, "../../..");
const enabled =
	process.env.QUESTPIE_CLI_ONBOARDING === "1" || !!process.env.PGHOST;

function snippet(text: string, path: string) {
	const language = path.endsWith(".json")
		? "json"
		: path.endsWith(".tsx")
			? "tsx"
			: path.endsWith(".html")
				? "html"
				: "ts";
	const marker = `\`\`\`${language} title="${path}"\n`;
	const start = text.indexOf(marker);
	if (start < 0) throw new Error(`missing tutorial file ${path}`);
	const end = text.indexOf("\n```", start + marker.length);
	return text.slice(start + marker.length, end) + "\n";
}

test.skipIf(!enabled)(
	"packed CLI provisions the exact Barbershop tutorial and executes typed data against PostgreSQL",
	async () => {
		const root = await mkdtemp(join(tmpdir(), "questpie-onboarding-"));
		const consumer = join(root, "app");
		const databaseName = `cli_onboarding_${crypto.randomUUID().replaceAll("-", "")}`;
		const databaseUrl = new URL(
			process.env.DATABASE_URL ?? "postgresql://localhost/postgres",
		);
		if (!process.env.DATABASE_URL) {
			databaseUrl.hostname = process.env.PGHOST!;
			databaseUrl.port = process.env.PGPORT ?? "5432";
			databaseUrl.username = process.env.PGUSER ?? "postgres";
			databaseUrl.password = process.env.PGPASSWORD ?? "";
			databaseUrl.pathname = `/${process.env.PGDATABASE ?? "postgres"}`;
		}
		const admin = new SQL(databaseUrl.href);
		await admin.unsafe(
			`CREATE DATABASE "${databaseName}" TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C.UTF-8' LC_CTYPE 'C.UTF-8'`,
		);
		databaseUrl.pathname = `/${databaseName}`;
		const deliveries: { summary: string; effectId: string | null }[] = [];
		const webhook = Bun.serve({
			hostname: "127.0.0.1",
			port: 0,
			async fetch(request) {
				const body = await request.json();
				deliveries.push({
					summary: body.summary,
					effectId: request.headers.get("Idempotency-Key"),
				});
				return new Response(null, { status: 202 });
			},
		});
		const env = {
			...process.env,
			DATABASE_URL: databaseUrl.href,
			TMPDIR: root,
			SUMMARY_WEBHOOK_URL: webhook.url.href,
			// schema-lifecycle.mdx documents this as a required
			// `export QUESTPIE_REALTIME_HMAC_KEY=$(openssl rand -hex 32)` step
			// before `scripts/try-ticket.ts`/`questpie start` will run; fix it here
			// so the packed-CLI proof is deterministic.
			QUESTPIE_REALTIME_HMAC_KEY:
				"0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			BETTER_AUTH_URL: "http://localhost:5173",
			BETTER_AUTH_SECRET: "barbershop-onboarding-test-secret-0123456789",
		};
		async function run(args: string[], cwd = consumer, expected = 0) {
			const child = Bun.spawn(args, {
				cwd,
				env,
				stdout: "pipe",
				stderr: "pipe",
			});
			const [code, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			expect(code, `${stdout}\n${stderr}`).toBe(expected);
			return stdout;
		}
		try {
			await mkdir(consumer);
			await run(
				[
					"bun",
					"pm",
					"pack",
					"--destination",
					root,
					"--ignore-scripts",
					"--quiet",
				],
				join(repository, "packages/questpie"),
			);
			const archive = (await readdir(root)).find((path) =>
				path.endsWith(".tgz"),
			)!;
			await run(["bun", "add", join(root, archive)]);
			const cli = ["bunx", "--no-install", "questpie"];
			await run([...cli, "init", "--name", "barbershopSupport"]);
			await run([
				"bun",
				"add",
				"better-auth@1.7.1",
				"pg@8.23.0",
				"auth@1.7.1",
				"@types/pg@8.23.1",
				"react@19.2.8",
				"react-dom@19.2.8",
				"@types/react",
				"@types/react-dom",
				"@tanstack/react-query@5.102.8",
				"vite@8.1.5",
				"@vitejs/plugin-react@6.0.4",
			]);
			for (const [page, paths] of [
				[
					"data-and-queries",
					[
						"src/context.ts",
						"src/data/tickets.ts",
						"src/data/comments.ts",
						"src/data/policies.ts",
						"src/queries/ticket-detail.ts",
					],
				],
				[
					"queries-and-mutations",
					["src/data/policies.ts", "src/mutations/rename-ticket.ts"],
				],
				[
					"schema-lifecycle",
					["src/data/demo-seed.ts", "scripts/try-ticket.ts"],
				],
				["clients", ["web/client.ts"]],
				[
					"custom-logic",
					[
						"src/jobs/rename-later.ts",
						"src/actions/send-summary.ts",
						"runtime/summary-webhook.ts",
					],
				],
				[
					"auth",
					[
						"runtime/auth.ts",
						"runtime/auth-migration.ts",
						"src/auth/service.ts",
						"src/auth/credentials.ts",
						"src/auth/routes.ts",
					],
				],
				[
					"react-query-basic",
					[
						"tsconfig.json",
						"web/support-screen.tsx",
						"web/ticket-screen.tsx",
						"web/main.ts",
						"web/index.html",
						"vite.config.ts",
					],
				],
			] as const) {
				const source = await readFile(
					join(repository, `apps/docs/content/docs/v4/${page}.mdx`),
					"utf8",
				);
				for (const path of paths) {
					await mkdir(dirname(join(consumer, path)), { recursive: true });
					await writeFile(join(consumer, path), snippet(source, path));
				}
			}
			await run([...cli, "build"]);
			await run([...cli, "check"]);
			await run([
				"bunx",
				"auth",
				"migrate",
				"--config",
				"runtime/auth-migration.ts",
				"--yes",
			]);
			await run(["bunx", "vite", "build", "--config", "vite.config.ts"]);
			const planned = JSON.parse(
				await run([...cli, "migration", "plan", "--name", "create-support"]),
			);
			expect(planned.status).toBe("planned");
			const created = JSON.parse(
				await run([...cli, "migration", "create", "--plan", planned.path]),
			);
			expect(created.identity).toBe("000001_create-support");
			expect((await readdir(join(consumer, created.path))).sort()).toEqual([
				"base-schema.json",
				"checksum.sha256",
				"migration.json",
				"plan.json",
				"target-schema.json",
				"up.sql",
			]);
			await run([...cli, "seed", "create"]);
			await run([...cli, "build"]);
			await run(["bun", "run", "types:check"]);
			await run([...cli, "migration", "apply"]);
			await run([...cli, "migration", "apply"]);
			await run([...cli, "seed", "apply"]);
			await run([...cli, "seed", "apply"]);
			expect(await run(["bun", "scripts/try-ticket.ts"])).toContain(
				"Please move my appointment",
			);
			expect(await run(["bun", "scripts/try-ticket.ts"])).toContain(
				"Please move my appointment",
			);
			const server = Bun.spawn([...cli, "start", "--port", "0"], {
				cwd: consumer,
				env,
				stdout: "pipe",
				stderr: "pipe",
			});
			const reader = server.stdout.getReader();
			try {
				const decoder = new TextDecoder();
				let output = "";
				let origin: string | undefined;
				const deadline = Date.now() + 30_000;
				while (!origin && Date.now() < deadline) {
					const chunk = await Promise.race([
						reader.read(),
						Bun.sleep(Math.max(1, deadline - Date.now())).then(() => {
							throw new Error("CLI startup timed out");
						}),
					]);
					if (chunk.done) throw new Error("CLI stopped before readiness");
					output += decoder.decode(chunk.value);
					origin = /questpie: listening on (http:\/\/[^\s]+)/.exec(output)?.[1];
				}
				expect(origin).toBeDefined();
				const url = new URL(origin!);
				url.hostname = "127.0.0.1";
				const response = await fetch(new URL("/_questpie/health/ready", url));
				expect(response.status).toBe(404);
				const signedUp = await fetch(new URL("/api/auth/sign-up/email", url), {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Origin: env.BETTER_AUTH_URL,
					},
					body: JSON.stringify({
						name: "Demo staff",
						email: "demo@example.com",
						password: "onboarding-demo-password",
					}),
				});
				expect(signedUp.status, await signedUp.clone().text()).toBe(200);
				const cookie = signedUp.headers
					.getSetCookie()
					.map((value) => value.split(";")[0])
					.join("; ");
				expect(cookie).toContain("session_token");
				const { createClient } = await import(
					join(consumer, ".questpie/generated/client.ts")
				);
				const input = {
					ids: ["018f5f6e-5f2c-7b41-a854-3d9a6b6b7131"],
					first: 1,
					after: null,
				};
				const context = { tenantId: "018f5f6e-5f2c-7b41-a854-3d9a6b6b7134" };
				const anonymous = createClient({ baseUrl: url.origin }).withContext(
					context,
				);
				await expect(
					anonymous.queries["tickets.detailPage"](input),
				).rejects.toBeDefined();
				const authenticated = createClient({
					baseUrl: url.origin,
					fetch: (request: Request) => {
						const headers = new Headers(request.headers);
						headers.set("Cookie", cookie);
						return fetch(new Request(request, { headers }));
					},
				}).withContext(context);
				const page = await authenticated.queries["tickets.detailPage"](input);
				expect(page.nodes[0].summary).toBe("Please move my appointment");
				await authenticated.mutations["tickets.rename"]({
					id: input.ids[0],
					summary: "Browser session update",
				});
				expect(
					(await authenticated.queries["tickets.detailPage"](input)).nodes[0]
						.summary,
				).toBe("Browser session update");
				await authenticated.actions["tickets.sendSummary"](
					{ id: input.ids[0] },
					{ effectKey: "docs-summary-v1" },
				);
				expect(deliveries).toHaveLength(1);
				expect(deliveries[0]!.summary).toBe("Browser session update");
				expect(deliveries[0]!.effectId).toBeTruthy();
				const receipt = await authenticated.mutations["tickets.deferRename"]({
					id: input.ids[0],
					summary: "Deferred worker update",
					requestKey: crypto.randomUUID(),
				});
				expect(receipt.runId).toBeString();
				let renamed = false;
				for (let attempt = 0; attempt < 40; attempt++) {
					if (
						(await authenticated.queries["tickets.detailPage"](input)).nodes[0]
							?.summary === "Deferred worker update"
					) {
						renamed = true;
						break;
					}
					await Bun.sleep(250);
				}
				expect(renamed).toBe(true);
				const signedOut = await fetch(new URL("/api/auth/sign-out", url), {
					method: "POST",
					headers: { Cookie: cookie, Origin: env.BETTER_AUTH_URL },
				});
				expect(signedOut.status).toBe(200);
				await expect(
					authenticated.queries["tickets.detailPage"](input),
				).rejects.toBeDefined();
			} finally {
				reader.releaseLock();
				server.kill("SIGTERM");
				expect(await server.exited).toBe(0);
			}
			// A real second schema change proves planning extends the committed head.
			const ticketPath = join(consumer, "src/data/tickets.ts");
			const ticket = await readFile(ticketPath, "utf8");
			await writeFile(
				ticketPath,
				ticket.replace(
					"summary: field.text(",
					"note: field.text({ nullable: true }),\n\t\tsummary: field.text(",
				),
			);
			const delta = JSON.parse(
				await run([...cli, "migration", "plan", "--name", "add-note"]),
			);
			expect(delta.plan.baseMigration).toBe(created.identity);
			// Tampering cannot produce an artifact even before source comparison.
			const planPath = join(consumer, delta.path);
			const originalPlan = await readFile(planPath, "utf8");
			await writeFile(planPath, originalPlan + " ");
			await run(
				[...cli, "migration", "create", "--plan", delta.path],
				consumer,
				1,
			);
			await writeFile(planPath, originalPlan);
			await writeFile(ticketPath, ticket);
			await run(
				[...cli, "migration", "create", "--plan", delta.path],
				consumer,
				2,
			);
			expect(
				(await readdir(join(consumer, "questpie/migrations"))).length,
			).toBe(1);

			await writeFile(
				ticketPath,
				ticket.replace("maxLength: 500", "maxLength: 400"),
			);
			const destructive = JSON.parse(
				await run([...cli, "migration", "plan", "--name", "tighten-summary"]),
			);
			expect(destructive.classification).toBe("destructive");
			await run(
				[...cli, "migration", "create", "--plan", destructive.path],
				consumer,
				2,
			);
			await run(
				[
					...cli,
					"migration",
					"create",
					"--plan",
					destructive.path,
					"--accept-destructive",
					"0".repeat(64),
				],
				consumer,
				2,
			);
			await run([
				...cli,
				"migration",
				"create",
				"--plan",
				destructive.path,
				"--accept-destructive",
				destructive.digest,
			]);
			await run([...cli, "build"]);
			await run([...cli, "migration", "apply"]);
			const narrowed = await readFile(ticketPath, "utf8");
			await writeFile(
				ticketPath,
				narrowed.replace(
					"summary: field.text(",
					"requiredFlag: field.boolean({ nullable: false }),\n\t\tsummary: field.text(",
				),
			);
			await rm(join(consumer, "src/data/demo-seed.ts"));
			const blocked = JSON.parse(
				await run([
					...cli,
					"migration",
					"plan",
					"--name",
					"blocked-required-field",
				]),
			);
			expect(blocked.classification).toBe("blocked");
			await run(
				[...cli, "migration", "create", "--plan", blocked.path],
				consumer,
				2,
			);
			expect(
				(await readdir(join(consumer, "questpie/migrations"))).length,
			).toBe(2);
		} finally {
			webhook.stop(true);
			await rm(root, { recursive: true, force: true });
			try {
				await admin.unsafe(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
			} finally {
				await admin.close();
			}
		}
	},
	240000,
);
