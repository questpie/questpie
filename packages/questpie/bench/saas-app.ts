/** Synthetic Autopilot-shaped fixture, never imported by production code. */
import pg from "pg";
import { z } from "zod";

import { pgNotifyEphemeralBroker } from "../src/exports/adapters/pg-notify.js";
import { collection } from "../src/exports/index.js";
import { createFetchHandler } from "../src/server/adapters/http.js";
import { channel } from "../src/server/channels/channel-builder.js";
import { createChannels } from "../src/server/channels/service.js";
import { ApiError } from "../src/server/errors/base.js";
import { route } from "../src/server/routes/define-route.js";
import { buildMockApp } from "../test/utils/mocks/mock-app-builder.js";
import { runTestDbMigrations } from "../test/utils/test-db.js";

export const url = process.env.QUESTPIE_EPHEMERAL_DATABASE_URL!;
if (!url) throw new Error("An isolated benchmark database is required");
export const tenants = 20;
export const tunedReads = process.env.SAAS_TUNE_READS === "1";
export const preparedAuth = process.env.SAAS_PREPARE_AUTH === "1";
type Scope = { tenant: number; spaces: number[] };
type AccessContext = {
	session?: { user: { id: string } } | null;
	scope?: Scope;
};

export async function saasApp() {
	const pool = new pg.Pool({
		connectionString: url,
		max: 12,
		application_name: "saas-auth",
	});
	const lifecycle: Record<string, number> = {};

	const broker = pgNotifyEphemeralBroker({ connectionString: url });
	const notifyLatency: number[] = [];
	let notifyFailures = 0;
	const observedBroker = {
		start: broker.start.bind(broker),
		stop: broker.stop.bind(broker),
		async publish(messages: readonly string[]) {
			const started = performance.now();
			try {
				await broker.publish(messages);
			} catch (error) {
				notifyFailures++;
				throw error;
			} finally {
				notifyLatency.push(performance.now() - started);
			}
		},
	};

	function authQuery(name: string, text: string, values: unknown[]) {
		return pool.query({ name: preparedAuth ? name : undefined, text, values });
	}

	let pendingMax = 0;
	const lag: number[] = [];
	let due = performance.now() + 500;
	const sample = setInterval(() => {
		pendingMax = Math.max(pendingMax, pool.waitingCount);
		lag.push(Math.max(0, performance.now() - due));
		due = performance.now() + 500;
	}, 500);
	sample.unref();
	async function canRead(ctx: AccessContext, page: number) {
		if (!ctx.session || !ctx.scope) return false;
		const result = await authQuery(
			"saas-page-acl",
			`with recursive ancestors as (
			select id,parent_id,deleted from saas_pages where id=$1 and tenant=$2 and space=any($3::int[])
			union select p.id,p.parent_id,p.deleted from saas_pages p join ancestors a on p.id=a.parent_id
		) select count(*)>0 and not bool_or(deleted) as allowed from ancestors`,
			[page, ctx.scope.tenant, ctx.scope.spaces],
		);
		return result.rows[0].allowed;
	}
	const channels = {
		page: channel("saas-page-[pageId]")
			.events({
				cursor: z.object({
					actor: z.string(),
					tenant: z.number(),
					pageId: z.number(),
					seq: z.number(),
					sentAt: z.number(),
					x: z.number(),
					y: z.number(),
				}),
			})
			.authorize({
				subscribe: (ctx) =>
					canRead(ctx as AccessContext, Number(ctx.params.pageId)),
				publish: false,
			})
			.presence(({ session }) => ({ id: session!.user.id }))
			.ephemeral(),
		activity: channel("saas-activity-[tenant]")
			.events({
				"list.changed": z.object({ tenant: z.number(), sentAt: z.number() }),
			})
			.authorize({
				subscribe: (ctx) => {
					const scope = (ctx as AccessContext).scope;
					return (
						!!scope &&
						scope.spaces.length > 0 &&
						scope.tenant === Number(ctx.params.tenant)
					);
				},
				publish: false,
			}),
	};
	let systemChannels: ReturnType<typeof createChannels<typeof channels>>;
	let saveTask: (
		id: string,
		body: string,
		revision: number,
	) => Promise<unknown>;
	const writes = new Map<number, number>();
	const setup = await buildMockApp(
		{
			collections: {
				tasks: collection("saas_tasks")
					.fields(({ f }) => ({
						tenant: f.number().required(),
						space: f.number().required(),
						title: f.text(255).required(),
						status: f.text(30).required(),
						body: f.textarea().required(),
						revision: f.number("double").default(0),
					}))
					.access({
						read: (ctx) => {
							const scope = (ctx as AccessContext).scope;
							return scope
								? { tenant: scope.tenant, space: { in: scope.spaces } }
								: false;
						},
						create: false,
						update: false,
						delete: false,
					})
					.options({
						realtime: {
							accessCacheKey:
								process.env.SAAS_ACCESS_SHARING === "tenant"
									? (ctx) => JSON.stringify((ctx as AccessContext).scope)
									: undefined,
						},
					}),
			},
			channels,
			config: {
				app: {
					context: async ({ session }: AccessContext) => {
						if (!session) return { scope: null };
						const result = await authQuery(
							"saas-scope",
							`select a.tenant,m.space from saas_actors a
				join saas_memberships m on m.actor=a.id and m.active
				join saas_bindings b on b.actor=a.id and b.space=m.space and b.active and b.expires>now()
				join saas_roles r on r.id=b.role and r.permissions @> array['space.read','knowledge.read']
				where a.id=$1 and a.active`,
							[session.user.id],
						);
						return {
							scope: result.rows.length
								? {
										tenant: result.rows[0].tenant,
										spaces: result.rows.map((row) => row.space),
									}
								: null,
						};
					},
				},
			},
			routes: {
				"bench/cursor": route()
					.post()
					.access(({ session }) => !!session)
					.schema(
						z.object({
							pageId: z.number().int(),
							seq: z.number().int(),
							sentAt: z.number(),
							x: z.number(),
							y: z.number(),
						}),
					)
					.handler(async (ctx) => {
						if (!(await canRead(ctx as AccessContext, ctx.input.pageId)))
							throw ApiError.forbidden({
								operation: "read",
								resource: "saas",
								reason: "Access denied",
							});
						await systemChannels
							.page({ pageId: String(ctx.input.pageId) })
							.publish(
								"cursor",
								{
									...ctx.input,
									actor: ctx.session!.user.id,
									tenant: (ctx as AccessContext).scope!.tenant,
								},
								{ coalesceKey: ctx.session!.user.id },
							);
						return { ok: true };
					}),
				"bench/list": route()
					.post()
					.access(({ session }) => !!session)
					.schema(z.object({ tenant: z.number().int() }))
					.handler(async (ctx) => {
						const scope = (ctx as AccessContext).scope;
						if (
							!scope ||
							scope.tenant !== ctx.input.tenant ||
							!scope.spaces.length
						)
							throw ApiError.forbidden({
								operation: "read",
								resource: "saas",
								reason: "Access denied",
							});
						return {
							items: (
								await pool.query(
									"select id,tenant,space,title,status from saas_tasks where tenant=$1 and space=any($2::int[]) order by updated_at desc,id limit 20",
									[scope.tenant, scope.spaces],
								)
							).rows,
						};
					}),
				"bench/save": route()
					.post()
					.access(({ session }) => !!session)
					.schema(
						z.object({
							taskId: z.string(),
							sentAt: z.number(),
							body: z.string().max(4096),
						}),
					)
					.handler(async (ctx) => {
						const scope = (ctx as AccessContext).scope;
						const record = (
							await pool.query(
								"select tenant,space from saas_tasks where id=$1",
								[ctx.input.taskId],
							)
						).rows[0];
						if (
							!scope ||
							!record ||
							record.tenant !== scope.tenant ||
							!scope.spaces.includes(record.space)
						)
							throw ApiError.forbidden({
								operation: "read",
								resource: "saas",
								reason: "Access denied",
							});
						await saveTask(ctx.input.taskId, ctx.input.body, ctx.input.sentAt);
						const revision = (writes.get(scope.tenant) ?? 0) + 1;
						writes.set(scope.tenant, revision);
						if (revision % 5 === 0)
							await systemChannels
								.activity({ tenant: String(scope.tenant) })
								.publish("list.changed", {
									tenant: scope.tenant,
									sentAt: ctx.input.sentAt,
								});
						return { ok: true };
					}),
			},
		},
		{
			db: { url, pool: { max: 16 } },
			realtime: {
				retentionDays: 0,
				ephemeral: { broker: observedBroker },
				observer: {
					record(event) {
						if (
							event.type === "session.closed" ||
							event.type === "session.opened"
						) {
							const key =
								event.type === "session.closed"
									? `${event.type}:${event.reason}`
									: event.type;
							lifecycle[key] = (lifecycle[key] ?? 0) + 1;
						}
						if (event.type === "topology.lifecycle") {
							const key = `${event.type}:${event.phase}:${event.outcome}`;
							lifecycle[key] = (lifecycle[key] ?? 0) + 1;
						}
					},
				},
			},
		},
	);
	systemChannels = createChannels(channels, setup.app.realtime, {
		accessMode: "system",
	} as any);
	const context = await setup.app.createContext({ accessMode: "system" });
	saveTask = (id, body, revision) =>
		setup.app.collections.tasks.update(
			{ id, data: { body, revision } },
			context,
		);
	const handler = createFetchHandler(setup.app, {
		requestLogging: { enabled: false },
		getSession: async (request) => {
			const result = await authQuery(
				"saas-session",
				`select a.id from saas_sessions s join saas_actors a on a.id=s.actor where s.token=$1 and s.expires>now() and a.active`,
				[request.headers.get("authorization")],
			);
			return result.rows.length
				? {
						user: { id: result.rows[0].id },
						session: { id: result.rows[0].id },
					}
				: null;
		},
	});
	return {
		setup,
		pool,
		handler,
		async cleanup() {
			clearInterval(sample);
			await setup.cleanup();
			await pool.end();
		},
		stats() {
			const notifySorted = [...notifyLatency].sort((a, b) => a - b);
			return {
				notifyPublish: {
					count: notifySorted.length,
					failures: notifyFailures,
					p95: notifySorted[Math.floor(notifySorted.length * 0.95)] ?? null,
					p99: notifySorted[Math.floor(notifySorted.length * 0.99)] ?? null,
					max: notifySorted.at(-1) ?? null,
				},
				lifecycle: { ...lifecycle },
				rss: process.memoryUsage().rss,
				cpu: process.cpuUsage(),
				authPoolWaitingMax: pendingMax,
				eventLoopLagMaxMs: Math.max(0, ...lag),
				errors: setup.app.mocks.logger
					.getLogsByLevel("error")
					.map((entry: { message: string }) => entry.message)
					.slice(-5),
			};
		},
	};
}

export async function seedSaas() {
	const app = await saasApp();
	await app.pool.query("create extension if not exists pg_trgm");
	await runTestDbMigrations(app.setup.app);
	await app.pool.query(`
		alter table saas_tasks add column if not exists revision double precision not null default 0;
		create table if not exists saas_actors(id text primary key,tenant int not null,active boolean not null default true);
		create table if not exists saas_sessions(token text primary key,actor text not null,expires timestamptz not null);
		create table if not exists saas_roles(id int primary key,permissions text[] not null);
		create table if not exists saas_memberships(actor text,space int,active boolean default true,primary key(actor,space));
		create table if not exists saas_bindings(actor text,space int,role int,active boolean default true,expires timestamptz,primary key(actor,space));
		create table if not exists saas_pages(id int primary key,tenant int,space int,parent_id int,deleted boolean default false);
		insert into saas_actors select 'actor-'||i,i%20,true from generate_series(0,1999) i on conflict do nothing;
		insert into saas_sessions select 'Bearer fixture-'||i,'actor-'||i,now()+interval '1 day' from generate_series(0,1999) i on conflict do nothing;
		insert into saas_roles values(1,array['space.read','knowledge.read','tasks.read','tasks.edit']) on conflict do nothing;
		insert into saas_memberships select a.id,a.tenant*4+s,true from saas_actors a cross join generate_series(0,3) s on conflict do nothing;
		insert into saas_bindings select actor,space,1,true,now()+interval '1 day' from saas_memberships on conflict do nothing;
		insert into saas_pages select 100000+i,i/4,i,null,false from generate_series(0,79) i on conflict do nothing;
		insert into saas_pages select i,i%20,(i%20)*4+(i/20)%4,100000+(i%20)*4+(i/20)%4,false from generate_series(0,99999) i on conflict do nothing;
		insert into saas_tasks(id,tenant,space,title,status,body) select 'task-'||i,i%20,(i%20)*4+(i/20)%4,'Task '||i,'open',repeat('x',1024) from generate_series(0,99999) i on conflict do nothing;
		create index if not exists saas_tasks_list on saas_tasks(tenant,updated_at desc,id);
		analyze saas_tasks; analyze saas_pages; analyze saas_memberships; analyze saas_bindings;
	`);
	if (tunedReads) {
		await app.pool.query(
			"create index if not exists saas_tasks_scope on saas_tasks(tenant,space) include(title,status,revision,updated_at)",
		);
		await app.pool.query(
			"create statistics if not exists saas_tasks_tenant_space (dependencies) on tenant,space from saas_tasks; create index if not exists saas_tasks_list_cover on saas_tasks(tenant,updated_at desc,id) include(space,title,status,revision); analyze saas_tasks",
		);
		await app.pool.query("vacuum(analyze) saas_tasks");
	} else {
		await app.pool.query(
			"drop index if exists saas_tasks_scope; drop index if exists saas_tasks_list_cover; drop statistics if exists saas_tasks_tenant_space; analyze saas_tasks",
		);
	}
	await app.cleanup();
}
