import { afterAll, beforeAll, expect, test } from "bun:test";

import { SQL } from "bun";

import { createStaticScheduleActivation } from "./activation";

const schema = `qp_schedule_proof_${crypto.randomUUID().replaceAll("-", "")}`;
const postgresTest = process.env.PGHOST ? test : test.skip;
let admin: SQL;
let schemaCreated = false;

beforeAll(async () => {
	if (!process.env.PGHOST) return;
	admin = new SQL({ bigint: true, max: 1 });
	const [version] = await admin.unsafe("SHOW server_version_num");
	expect(String(version.server_version_num)).toMatch(/^17\d{4}$/u);
	await admin.unsafe(`CREATE SCHEMA "${schema}"`);
	schemaCreated = true;
	await admin.unsafe(`
		CREATE TABLE "${schema}"."activation_heads" (
			"application_id" text PRIMARY KEY,
			"revision" bigint NOT NULL CHECK ("revision" > 0),
			"target_digest" text NOT NULL,
			"activated_at" timestamptz NOT NULL
		);
		CREATE TABLE "${schema}"."activation_programs" (
			"application_id" text NOT NULL,
			"job_id" text NOT NULL,
			"program_digest" text NOT NULL,
			"lower_bound" timestamptz NOT NULL,
			"frontier_minute" timestamptz NOT NULL,
			"activation_revision" bigint NOT NULL,
			PRIMARY KEY ("application_id", "job_id")
		);
		CREATE TABLE "${schema}"."activation_requests" (
			"application_id" text NOT NULL,
			"expected_revision" bigint NOT NULL,
			"target_digest" text NOT NULL,
			"accepted_revision" bigint NOT NULL,
			"activated_at" timestamptz NOT NULL,
			PRIMARY KEY ("application_id", "expected_revision", "target_digest")
		);
		CREATE TABLE "${schema}"."accepted_ticks" (
			"application_id" text NOT NULL,
			"job_id" text NOT NULL,
			"tick_minute" timestamptz NOT NULL,
			"accepted_revision" bigint NOT NULL,
			"program_digest" text NOT NULL,
			"accepted_at" timestamptz NOT NULL,
			PRIMARY KEY ("application_id", "job_id", "tick_minute")
		)
	`);
});

afterAll(async () => {
	if (!admin) return;
	try {
		if (schemaCreated) await admin.unsafe(`DROP SCHEMA "${schema}" CASCADE`);
	} finally {
		await admin.close({ timeout: 0 });
	}
});

postgresTest(
	"the activation-containing minute is excluded, including its exact boundary",
	async () => {
		const activation = createStaticScheduleActivation(admin, { schema });
		const receipt = await activation.activate({
			applicationId: "exact-boundary",
			expectedRevision: 0n,
			programs: [{ jobId: "reports.minute", programDigest: "minute" }],
		});
		expect(
			await activation.produce({
				applicationId: "exact-boundary",
				expectedRevision: 1n,
				jobId: "reports.minute",
				tickMinute: receipt.activatedAt,
			}),
		).toEqual({ status: "ineligible", reason: "BEFORE_LOWER_BOUND" });
		expect(
			(await activation.inspect({ applicationId: "exact-boundary" })).ticks,
		).toEqual([]);
	},
);

postgresTest(
	"an unaccepted minute behind the durable frontier cannot become new work",
	async () => {
		const activation = createStaticScheduleActivation(admin, { schema });
		await activation.activate({
			applicationId: "past-frontier",
			expectedRevision: 0n,
			programs: [{ jobId: "reports.minute", programDigest: "minute" }],
		});
		// Controlled past state, not a calendar evaluator or an application interface.
		await admin.unsafe(
			`UPDATE "${schema}"."activation_programs"
		SET lower_bound = '2020-01-01T00:00:00Z', frontier_minute = '2020-01-01T00:03:00Z'
		WHERE application_id = $1`,
			["past-frontier"],
		);
		expect(
			await activation.produce({
				applicationId: "past-frontier",
				expectedRevision: 1n,
				jobId: "reports.minute",
				tickMinute: "2020-01-01T00:02:00.000Z",
			}),
		).toEqual({ status: "ineligible", reason: "BEHIND_FRONTIER" });
		expect(
			(await activation.inspect({ applicationId: "past-frontier" })).ticks,
		).toEqual([]);
	},
);

postgresTest(
	"runtime boot inspects absent activation inside a read-only transaction",
	async () => {
		const client = new SQL({ bigint: true, max: 1 });
		try {
			const state = await client.begin("read only", async (transaction) =>
				createStaticScheduleActivation(transaction, { schema }).inspect({
					applicationId: "support-desk",
				}),
			);
			expect(state).toEqual({ head: null, programs: [], ticks: [] });
		} finally {
			await client.close({ timeout: 0 });
		}
	},
);

postgresTest(
	"ten independent activators admit one competing expected revision",
	async () => {
		const clients = Array.from(
			{ length: 10 },
			() => new SQL({ bigint: true, max: 1 }),
		);
		try {
			const attempts = await Promise.allSettled(
				clients.map((client, index) =>
					createStaticScheduleActivation(client, { schema }).activate({
						applicationId: "concurrent-app",
						expectedRevision: 0n,
						programs: [
							{ jobId: "reports.daily", programDigest: `program-${index}` },
						],
					}),
				),
			);
			const winners = attempts.filter(
				(result) => result.status === "fulfilled",
			);
			const losers = attempts.filter((result) => result.status === "rejected");
			expect(winners).toHaveLength(1);
			expect(losers).toHaveLength(9);
			expect(
				losers.every(
					(result) =>
						result.status === "rejected" &&
						result.reason instanceof Error &&
						result.reason.message === "ACTIVATION_STALE",
				),
			).toBe(true);
			const winner = winners[0];
			if (winner?.status !== "fulfilled") throw new Error("missing winner");
			expect(winner.value).toMatchObject({
				acceptedRevision: 1n,
				currentHead: { revision: 1n },
				replayed: false,
			});
			const observed = await createStaticScheduleActivation(clients[0]!, {
				schema,
			}).inspect({ applicationId: "concurrent-app" });
			expect(observed.head).toEqual(winner.value.currentHead);
		} finally {
			await Promise.all(clients.map((client) => client.close({ timeout: 0 })));
		}
	},
);

postgresTest(
	"historical receipts survive response loss while monotonic revisions defeat ABA",
	async () => {
		const activation = createStaticScheduleActivation(admin, { schema });
		const targetA = [
			{
				jobId: "reports.digest",
				programDigest: "cron-A-service-context-input",
			},
		] as const;
		const targetB = [
			{
				jobId: "reports.digest",
				programDigest: "cron-B-service-context-input",
			},
		] as const;
		const first = await activation.activate({
			applicationId: "aba-app",
			expectedRevision: 0n,
			programs: targetA,
		});
		await activation.activate({
			applicationId: "aba-app",
			expectedRevision: 1n,
			programs: targetB,
		});
		const returnedToA = await activation.activate({
			applicationId: "aba-app",
			expectedRevision: 2n,
			programs: targetA,
		});

		const responseLossReplay = await activation.activate({
			applicationId: "aba-app",
			expectedRevision: 0n,
			programs: targetA,
		});
		expect(responseLossReplay).toEqual({
			...first,
			currentHead: returnedToA.currentHead,
			replayed: true,
		});
		await expect(
			activation.activate({
				applicationId: "aba-app",
				expectedRevision: 1n,
				programs: targetA,
			}),
		).rejects.toThrow("ACTIVATION_STALE");
		const state = await activation.inspect({ applicationId: "aba-app" });
		expect(state.head).toEqual(returnedToA.currentHead);
		expect(state.head?.revision).toBe(3n);
	},
);

postgresTest(
	"the maximum PostgreSQL bigint revision fails closed",
	async () => {
		await admin.unsafe(
			`INSERT INTO "${schema}"."activation_heads"
		 ("application_id", "revision", "target_digest", "activated_at")
		 VALUES ($1, $2, $3, date_trunc('minute', clock_timestamp(), 'UTC'))`,
			["overflow-app", 9_223_372_036_854_775_807n, "old-target"],
		);
		await expect(
			createStaticScheduleActivation(admin, { schema }).activate({
				applicationId: "overflow-app",
				expectedRevision: 9_223_372_036_854_775_807n,
				programs: [],
			}),
		).rejects.toThrow("ACTIVATION_REVISION_OVERFLOW");
		const state = await createStaticScheduleActivation(admin, {
			schema,
		}).inspect({
			applicationId: "overflow-app",
		});
		expect(state.head?.revision).toBe(9_223_372_036_854_775_807n);
	},
);

postgresTest(
	"ten producers admit one UTC-minute tick and suppress pre-activation history",
	async () => {
		const activation = createStaticScheduleActivation(admin, { schema });
		const activated = await activation.activate({
			applicationId: "tick-app",
			expectedRevision: 0n,
			programs: [{ jobId: "reports.minute", programDigest: "minute-program" }],
		});
		const beforeActivation = new Date(
			Date.parse(activated.activatedAt) - 60_000,
		).toISOString();
		expect(
			await activation.produce({
				applicationId: "tick-app",
				expectedRevision: 1n,
				jobId: "reports.minute",
				tickMinute: beforeActivation,
			}),
		).toEqual({ status: "ineligible", reason: "BEFORE_LOWER_BOUND" });

		// Model an earlier activation so a due minute is available without sleeping.
		await admin.unsafe(
			`UPDATE "${schema}"."activation_programs"
		SET lower_bound = $2::timestamptz, frontier_minute = $2::timestamptz
		WHERE application_id = $1`,
			["tick-app", beforeActivation],
		);

		const clients = Array.from(
			{ length: 10 },
			() => new SQL({ bigint: true, max: 1 }),
		);
		try {
			const results = await Promise.all(
				clients.map((client) =>
					createStaticScheduleActivation(client, { schema }).produce({
						applicationId: "tick-app",
						expectedRevision: 1n,
						jobId: "reports.minute",
						tickMinute: activated.activatedAt,
					}),
				),
			);
			expect(
				results.filter(({ status }) => status === "accepted"),
			).toHaveLength(1);
			expect(
				results.filter(({ status }) => status === "duplicate"),
			).toHaveLength(9);
			const state = await activation.inspect({ applicationId: "tick-app" });
			expect(state.ticks).toEqual([
				{
					acceptedRevision: 1n,
					jobId: "reports.minute",
					programDigest: "minute-program",
					tickMinute: activated.activatedAt,
				},
			]);
			expect(state.programs[0]?.frontierMinute).toBe(activated.activatedAt);
		} finally {
			await Promise.all(clients.map((client) => client.close({ timeout: 0 })));
		}
	},
);

postgresTest(
	"frontiers transfer only across adjacent equal programs and removal preserves ticks",
	async () => {
		const activation = createStaticScheduleActivation(admin, { schema });
		const applicationId = "frontier-app";
		const jobId = "reports.frontier";
		const first = await activation.activate({
			applicationId,
			expectedRevision: 0n,
			programs: [{ jobId, programDigest: "program-A" }],
		});
		await admin.unsafe(
			`UPDATE "${schema}"."activation_programs"
		 SET "lower_bound" = '2020-01-01T00:00:00.000Z',
		     "frontier_minute" = '2024-01-01T00:00:00.000Z'
		 WHERE "application_id" = $1 AND "job_id" = $2`,
			[applicationId, jobId],
		);
		await activation.activate({
			applicationId,
			expectedRevision: 1n,
			programs: [{ jobId, programDigest: "program-A" }],
		});
		let state = await activation.inspect({ applicationId });
		expect(state.programs[0]).toMatchObject({
			activationRevision: 2n,
			frontierMinute: "2024-01-01T00:00:00.000Z",
			lowerBound: "2020-01-01T00:00:00.000Z",
			programDigest: "program-A",
		});

		const changed = await activation.activate({
			applicationId,
			expectedRevision: 2n,
			programs: [{ jobId, programDigest: "program-B" }],
		});
		state = await activation.inspect({ applicationId });
		expect(state.programs[0]).toMatchObject({
			activationRevision: 3n,
			frontierMinute: changed.activatedAt,
			lowerBound: changed.activatedAt,
			programDigest: "program-B",
		});
		// Supply already-active past state; calendar enumeration is outside this model.
		await admin.unsafe(
			`UPDATE "${schema}"."activation_programs"
		SET lower_bound = '2020-01-01T00:00:00Z', frontier_minute = '2020-01-01T00:00:00Z'
		WHERE application_id = $1`,
			[applicationId],
		);
		const accepted = await activation.produce({
			applicationId,
			expectedRevision: 3n,
			jobId,
			tickMinute: changed.activatedAt,
		});
		expect(accepted.status).toBe("accepted");
		await activation.activate({
			applicationId,
			expectedRevision: 3n,
			programs: [],
		});
		state = await activation.inspect({ applicationId });
		expect(state.programs).toEqual([]);
		expect(state.ticks).toHaveLength(1);
		expect(
			await activation.produce({
				applicationId,
				expectedRevision: 3n,
				jobId,
				tickMinute: changed.activatedAt,
			}),
		).toEqual({ status: "ineligible", reason: "STALE_ACTIVATION" });
		expect(
			await activation.produce({
				applicationId,
				expectedRevision: 4n,
				jobId,
				tickMinute: changed.activatedAt,
			}),
		).toEqual({ status: "ineligible", reason: "JOB_REMOVED" });

		const readded = await activation.activate({
			applicationId,
			expectedRevision: 4n,
			programs: [{ jobId, programDigest: "program-B" }],
		});
		state = await activation.inspect({ applicationId });
		expect(state.programs[0]).toMatchObject({
			activationRevision: 5n,
			frontierMinute: readded.activatedAt,
			lowerBound: readded.activatedAt,
		});
		expect(
			await activation.produce({
				applicationId,
				expectedRevision: 5n,
				jobId,
				tickMinute: changed.activatedAt,
			}),
		).toMatchObject({ status: "duplicate", acceptedRevision: 3n });
		state = await activation.inspect({ applicationId });
		expect(state.ticks).toEqual([
			{
				acceptedRevision: 3n,
				jobId,
				programDigest: "program-B",
				tickMinute: changed.activatedAt,
			},
		]);
		expect(first.acceptedRevision).toBe(1n);
	},
);

async function prepareDue(applicationId: string) {
	const activation = createStaticScheduleActivation(admin, { schema });
	await activation.activate({
		applicationId,
		expectedRevision: 0n,
		programs: [{ jobId: "reports.minute", programDigest: "minute" }],
	});
	await admin.unsafe(
		`UPDATE "${schema}"."activation_programs"
		SET lower_bound = '2020-01-01T00:00:00Z', frontier_minute = '2020-01-01T00:00:00Z'
		WHERE application_id = $1`,
		[applicationId],
	);
	return activation;
}

async function blocked(pid: number) {
	for (let attempt = 0; attempt < 200; attempt += 1) {
		const [row] = await admin.unsafe(
			"SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked",
			[pid],
		);
		if (row.blocked === true) return;
		await Bun.sleep(5);
	}
	throw new Error("proof lock waiter did not arrive within its bound");
}

postgresTest(
	"both lock orders serialize removal against a pending producer",
	async () => {
		for (const first of ["producer", "removal"] as const) {
			const applicationId = `lock-order-${first}`;
			const activation = await prepareDue(applicationId);
			const locker = new SQL({ bigint: true, max: 1 });
			const producer = new SQL({ bigint: true, max: 1 });
			const remover = new SQL({ bigint: true, max: 1 });
			const acquired = Promise.withResolvers<void>();
			const release = Promise.withResolvers<void>();
			const pending: Promise<unknown>[] = [];
			try {
				const [producerPid] = await producer.unsafe(
					"SELECT pg_backend_pid() AS pid",
				);
				const [removerPid] = await remover.unsafe(
					"SELECT pg_backend_pid() AS pid",
				);
				const holding = locker.begin(async (transaction) => {
					await transaction.unsafe(
						`SELECT revision FROM "${schema}"."activation_heads"
					WHERE application_id = $1 FOR UPDATE`,
						[applicationId],
					);
					acquired.resolve();
					await release.promise;
				});
				pending.push(holding);
				void holding.catch(acquired.reject);
				await acquired.promise;
				const produce = () =>
					createStaticScheduleActivation(producer, { schema }).produce({
						applicationId,
						expectedRevision: 1n,
						jobId: "reports.minute",
						tickMinute: "2020-01-01T00:01:00.000Z",
					});
				const remove = () =>
					createStaticScheduleActivation(remover, { schema }).activate({
						applicationId,
						expectedRevision: 1n,
						programs: [],
					});
				const firstWork = first === "producer" ? produce() : remove();
				pending.push(firstWork);
				await blocked(first === "producer" ? producerPid.pid : removerPid.pid);
				const secondWork = first === "producer" ? remove() : produce();
				pending.push(secondWork);
				await blocked(first === "producer" ? removerPid.pid : producerPid.pid);
				release.resolve();
				const outcomes = await Promise.all([firstWork, secondWork]);
				const produced = outcomes[first === "producer" ? 0 : 1];
				expect(produced).toMatchObject(
					first === "producer"
						? { status: "accepted" }
						: { status: "ineligible", reason: "STALE_ACTIVATION" },
				);
				const state = await activation.inspect({ applicationId });
				expect(state.head?.revision).toBe(2n);
				expect(state.programs).toEqual([]);
				expect(state.ticks).toHaveLength(first === "producer" ? 1 : 0);
			} finally {
				release.resolve();
				await Promise.allSettled(pending);
				await Promise.all(
					[locker, producer, remover].map((client) =>
						client.close({ timeout: 0 }),
					),
				);
			}
		}
	},
);

postgresTest(
	"a frontier write failure rolls back its synthetic tick receipt",
	async () => {
		const activation = await prepareDue("rollback-app");
		await admin.unsafe(`ALTER TABLE "${schema}"."activation_programs"
		ADD CONSTRAINT proof_frontier_fault CHECK (application_id <> 'rollback-app'
		OR frontier_minute < '2020-01-01T00:01:00Z'::timestamptz)`);
		const before = await activation.inspect({ applicationId: "rollback-app" });
		await expect(
			activation.produce({
				applicationId: "rollback-app",
				expectedRevision: 1n,
				jobId: "reports.minute",
				tickMinute: "2020-01-01T00:01:00.000Z",
			}),
		).rejects.toThrow();
		expect(await activation.inspect({ applicationId: "rollback-app" })).toEqual(
			before,
		);
	},
);

postgresTest(
	"an observed abort while waiting on activation accepts nothing",
	async () => {
		const applicationId = "cancel-waiter";
		const activation = await prepareDue(applicationId);
		const locker = new SQL({ bigint: true, max: 1 });
		const producer = new SQL({ bigint: true, max: 1 });
		const acquired = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		const pending: Promise<unknown>[] = [];
		try {
			const [producerPid] = await producer.unsafe(
				"SELECT pg_backend_pid() AS pid",
			);
			const holding = locker.begin(async (transaction) => {
				await transaction.unsafe(
					`SELECT revision FROM "${schema}"."activation_heads"
				WHERE application_id = $1 FOR UPDATE`,
					[applicationId],
				);
				acquired.resolve();
				await release.promise;
			});
			pending.push(holding);
			void holding.catch(acquired.reject);
			await acquired.promise;
			const controller = new AbortController();
			const work = createStaticScheduleActivation(producer, { schema }).produce(
				{
					applicationId,
					expectedRevision: 1n,
					jobId: "reports.minute",
					tickMinute: "2020-01-01T00:01:00.000Z",
					signal: controller.signal,
				},
			);
			pending.push(work);
			const outcome = work.then(
				(value) => ({ value, error: null }),
				(error: unknown) => ({ value: null, error }),
			);
			await blocked(producerPid.pid);
			controller.abort(new Error("proof cancellation"));
			release.resolve();
			expect((await outcome).error).toEqual(new Error("proof cancellation"));
			const state = await activation.inspect({ applicationId });
			expect(state.ticks).toEqual([]);
			expect(state.programs[0]?.frontierMinute).toBe(
				"2020-01-01T00:00:00.000Z",
			);
		} finally {
			release.resolve();
			await Promise.allSettled(pending);
			await Promise.all(
				[locker, producer].map((client) => client.close({ timeout: 0 })),
			);
		}
	},
);
