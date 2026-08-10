import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	setDefaultTimeout,
} from "bun:test";

import { collection, global, runWithContext } from "questpie";
import { sql } from "questpie/drizzle";
import { createFetchHandler } from "questpie/http";

import { buildMockApp } from "../../../questpie/test/utils/mocks/mock-app-builder";
import { createTestContext } from "../../../questpie/test/utils/test-context";
import { runTestDbMigrations } from "../../../questpie/test/utils/test-db";
import {
	AUDIT_LOG_COLLECTION,
	auditLogCollection,
	auditModule,
	toCanonicalAuditEvent,
} from "../../src/server/modules/audit/index.js";
import { auditCleanupJob } from "../../src/server/modules/audit/jobs/audit-cleanup.js";

const REDACTED_VALUE = "[REDACTED]";

setDefaultTimeout(60_000);

const policyRecords = collection("policy_records")
	.fields(({ f }) => ({
		title: f.text().required().set("audit", "include"),
		privateNote: f.text().set("audit", "redact"),
		internalMemo: f.text().set("audit", "omit"),
		password: f.text(),
		accessToken: f.text(),
	}))
	.options({
		versioning: {
			workflow: {
				initialStage: "draft",
				stages: ["draft", "published"],
			},
		},
	});

const policySettings = global("policy_settings")
	.fields(({ f }) => ({
		title: f.text().set("audit", "include"),
		privateNote: f.text().set("audit", "redact"),
		internalMemo: f.text().set("audit", "omit"),
	}))
	.options({
		versioning: {
			workflow: {
				initialStage: "draft",
				stages: ["draft", "published"],
			},
		},
	});

const authorizedAuditLog = collection("admin_audit_log")
	.merge(auditLogCollection)
	.access({
		read: ({ session }) => session?.user?.id === "auditor-1",
		create: false,
		update: false,
		delete: false,
	});

type AuditPolicy = {
	persistence?: "best-effort" | "required";
	retention?: { days: number | null; legalHold?: (event: unknown) => boolean };
	export?: {
		delivery?: "after-commit";
		sink: { append: (event: unknown) => Promise<void> | void };
	};
};

function auditModuleWith(policy: AuditPolicy) {
	return {
		...auditModule,
		config: {
			...auditModule.config,
			audit: policy,
		},
	};
}

async function rejectAuditAction(app: any, action: string): Promise<void> {
	await app.db.execute(
		sql.raw(
			`ALTER TABLE "${AUDIT_LOG_COLLECTION}" ADD CONSTRAINT "reject_${action}_audit" CHECK (action <> '${action}') NOT VALID`,
		),
	);
}

async function allowAuditAction(app: any, action: string): Promise<void> {
	await app.db.execute(
		sql.raw(
			`ALTER TABLE "${AUDIT_LOG_COLLECTION}" DROP CONSTRAINT "reject_${action}_audit"`,
		),
	);
}

describe("audit policy contract", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	async function resetWithPolicy(policy: AuditPolicy): Promise<void> {
		await setup.cleanup();
		setup = await buildMockApp({
			collections: { policyRecords },
			globals: { policySettings },
			modules: [auditModuleWith(policy) as any],
			defaultAccess: { read: true, create: true, update: true, delete: true },
		});
		await runTestDbMigrations(setup.app);
	}

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: { policyRecords },
			globals: { policySettings },
			modules: [auditModule],
			defaultAccess: { read: true, create: true, update: true, delete: true },
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("UC-AUD-001 F04 preserves the 3.x public audit-read default", async () => {
		const handler = createFetchHandler(setup.app, { basePath: "/api" });
		const response = await handler(
			new Request(`http://localhost/api/${AUDIT_LOG_COLLECTION}`),
		);

		expect(response.status).toBe(200);
	});

	it("UC-AUD-001 permits an application to opt into restricted audit reads", async () => {
		await setup.cleanup();
		setup = await buildMockApp({
			collections: {
				policyRecords,
				admin_audit_log: authorizedAuditLog,
			},
			modules: [auditModule],
			defaultAccess: { read: true, create: true, update: true, delete: true },
		});
		await runTestDbMigrations(setup.app);
		const handler = createFetchHandler(setup.app, { basePath: "/api" });
		expect(
			(
				await handler(
					new Request(`http://localhost/api/${AUDIT_LOG_COLLECTION}`),
				)
			).status,
		).toBe(403);

		const authenticated = createTestContext({
			accessMode: "user",
			session: {
				user: { id: "auditor-1", name: "Audit Tester" },
				session: { id: "audit-session-1" },
			} as any,
		});

		await expect(
			setup.app.collections[AUDIT_LOG_COLLECTION].find({}, authenticated),
		).resolves.toMatchObject({ docs: [] });
	});

	it("UC-AUD-002 F05 includes, redacts, and omits classified field values and credential defaults", async () => {
		const systemCtx = createTestContext({ accessMode: "system" });
		const record = await setup.app.collections.policyRecords.create(
			{
				title: "Before",
				privateNote: "old-private",
				internalMemo: "old-internal",
				password: "old-password",
				accessToken: "old-token",
			},
			systemCtx,
		);
		const authenticated = createTestContext({
			accessMode: "user",
			session: {
				user: { id: "auditor-1", name: "Audit Tester" },
				session: { id: "audit-session-1" },
			} as any,
		});
		await setup.app.collections.policyRecords.updateById(
			{
				id: record.id,
				data: {
					title: "After",
					privateNote: "new-private",
					internalMemo: "new-internal",
					password: "new-password",
					accessToken: "new-token",
				},
			},
			authenticated,
		);

		const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
			{
				where: {
					resource: "policyRecords",
					resourceId: record.id,
					action: "update",
				},
			},
			systemCtx,
		);
		const changes = logs.docs[0]?.changes;

		expect(changes).toMatchObject({
			title: { from: "Before", to: "After" },
			privateNote: { from: REDACTED_VALUE, to: REDACTED_VALUE },
		});
		expect(changes).not.toHaveProperty("internalMemo");
		expect(changes).not.toHaveProperty("password");
		expect(changes).not.toHaveProperty("accessToken");
	});

	it("UC-AUD-003 F06 rolls back a protected mutation after a real required audit SQL failure", async () => {
		const delivered: unknown[] = [];
		await resetWithPolicy({
			persistence: "required",
			export: { sink: { append: (event) => delivered.push(event) } },
		});

		await rejectAuditAction(setup.app, "create");
		const ctx = createTestContext({ accessMode: "system" });

		await expect(
			setup.app.collections.policyRecords.create(
				{ id: "required-failure", title: "Must roll back" },
				ctx,
			),
		).rejects.toThrow();

		expect(
			await setup.app.collections.policyRecords.findOne(
				{ where: { id: "required-failure" } },
				ctx,
			),
		).toBeNull();
		expect(delivered).toHaveLength(0);
	});

	it("rolls back required update, delete, and purge audit SQL failures without sink delivery", async () => {
		const ctx = createTestContext({ accessMode: "system" });

		for (const action of ["update", "delete", "purge"] as const) {
			const delivered: unknown[] = [];
			await resetWithPolicy({
				persistence: "required",
				export: { sink: { append: (event) => delivered.push(event) } },
			});
			const id = `required-${action}`;
			await setup.app.collections.policyRecords.create(
				{ id, title: "Before" },
				ctx,
			);
			delivered.length = 0;
			await rejectAuditAction(setup.app, action);

			if (action === "update") {
				await expect(
					setup.app.collections.policyRecords.updateById(
						{ id, data: { title: "After" } },
						ctx,
					),
				).rejects.toThrow();
			} else if (action === "delete") {
				await expect(
					setup.app.collections.policyRecords.deleteById({ id }, ctx),
				).rejects.toThrow();
			} else {
				await expect(
					setup.app.collections.policyRecords.purgeById({ id }, ctx),
				).rejects.toThrow();
			}

			const unchanged = await setup.app.collections.policyRecords.findOne(
				{ where: { id } },
				ctx,
			);
			expect(unchanged).toMatchObject({ id, title: "Before" });
			expect(delivered).toHaveLength(0);
		}
	});

	it("UC-AUD-003 F07 commits and logs after a real best-effort audit SQL failure", async () => {
		await rejectAuditAction(setup.app, "create");
		const ctx = createTestContext({ accessMode: "system" });

		const record = await setup.app.collections.policyRecords.create(
			{ id: "best-effort-failure", title: "Still commits" },
			ctx,
		);
		expect(record.id).toBe("best-effort-failure");
		const failure = (ctx.logger as any).getLogsByLevel("error")[0];
		expect(failure).toMatchObject({
			level: "error",
			message: "[Audit] Best-effort persistence failed:",
		});
		expect(failure.args[0]).toMatchObject({
			error: expect.objectContaining({
				message: expect.any(String),
			}),
			operation: "create",
			resource: "policyRecords",
		});
	});

	it("propagates a required transition audit failure through the fatal hook boundary", async () => {
		const delivered: unknown[] = [];
		await resetWithPolicy({
			persistence: "required",
			export: { sink: { append: (event) => delivered.push(event) } },
		});
		const ctx = createTestContext({ accessMode: "system" });
		const record = await setup.app.collections.policyRecords.create(
			{ id: "required-transition", title: "Draft" },
			ctx,
		);
		delivered.length = 0;
		await rejectAuditAction(setup.app, "transition");

		await expect(
			setup.app.collections.policyRecords.transitionStage(
				{ id: record.id, stage: "published" },
				ctx,
			),
		).rejects.toThrow();
		expect(delivered).toHaveLength(0);
		expect(
			await setup.app.collections.policyRecords.findOne(
				{ where: { id: record.id }, stage: "published" },
				ctx,
			),
		).toBeNull();

		await allowAuditAction(setup.app, "transition");
		await expect(
			setup.app.collections.policyRecords.transitionStage(
				{ id: record.id, stage: "published" },
				ctx,
			),
		).resolves.toBeDefined();
	});

	it("rolls back a required global update and transition audit SQL failure without sink delivery", async () => {
		const delivered: unknown[] = [];
		await resetWithPolicy({
			persistence: "required",
			export: { sink: { append: (event) => delivered.push(event) } },
		});
		const ctx = createTestContext({ accessMode: "system" });
		await setup.app.globals.policySettings.update({ title: "Before" }, ctx);
		delivered.length = 0;
		await rejectAuditAction(setup.app, "update");

		await expect(
			setup.app.globals.policySettings.update({ title: "After" }, ctx),
		).rejects.toThrow();
		expect(await setup.app.globals.policySettings.get({}, ctx)).toMatchObject({
			title: "Before",
		});
		expect(delivered).toHaveLength(0);

		await allowAuditAction(setup.app, "update");
		await rejectAuditAction(setup.app, "transition");
		await expect(
			setup.app.globals.policySettings.transitionStage(
				{ stage: "published" },
				ctx,
			),
		).rejects.toThrow();
		expect(delivered).toHaveLength(0);
		expect(
			await setup.app.globals.policySettings.get({ stage: "published" }, ctx),
		).toBeNull();

		await allowAuditAction(setup.app, "transition");
		await expect(
			setup.app.globals.policySettings.transitionStage(
				{ stage: "published" },
				ctx,
			),
		).resolves.toBeDefined();
	});

	it("UC-AUD-004 emits stable event, actor, outcome, and correlation metadata", async () => {
		const ctx = createTestContext({
			accessMode: "system",
			requestId: "req-audit-1",
			traceId: "trace-audit-1",
			workload: { type: "job", id: "retention-worker" },
		} as any);
		const record = await setup.app.collections.policyRecords.create(
			{ title: "Correlated" },
			ctx,
		);

		const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
			{ where: { resource: "policyRecords", resourceId: record.id } },
			ctx,
		);
		const event = logs.docs[0];

		expect(event.id).toEqual(expect.any(String));
		expect(event.createdAt).toBeInstanceOf(Date);
		expect(event.metadata).toMatchObject({
			outcome: "succeeded",
			actorType: "system",
			actorId: "retention-worker",
			actorName: "retention-worker",
			requestId: "req-audit-1",
			traceId: "trace-audit-1",
		});

		const canonical = toCanonicalAuditEvent(event);
		expect(canonical).toEqual({
			id: event.id,
			timestamp: event.createdAt.toISOString(),
			outcome: "succeeded",
			action: "create",
			resource: {
				type: "collection",
				name: "policyRecords",
				id: record.id,
			},
			actor: {
				type: "system",
				id: "retention-worker",
				name: "retention-worker",
			},
			requestId: "req-audit-1",
			traceId: "trace-audit-1",
			changes: { title: { from: null, to: "Correlated" } },
			metadata: event.metadata,
		});
	});

	it("inherits workload identity from ambient context", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		const record = await runWithContext(
			{
				app: setup.app,
				accessMode: "system",
				workload: {
					type: "job",
					id: "retention-worker",
					name: "Retention worker",
				},
			},
			() =>
				setup.app.collections.policyRecords.create(
					{ title: "Ambient workload" },
					{ accessMode: "system" },
				),
		);

		const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
			{ where: { resource: "policyRecords", resourceId: record.id } },
			ctx,
		);
		expect(logs.docs[0]?.metadata).toMatchObject({
			actorId: "retention-worker",
			actorName: "Retention worker",
		});
	});

	it("preserves actor, workload, and correlation through global change and transition hooks", async () => {
		const ctx = createTestContext({
			accessMode: "system",
			requestId: "req-global-audit",
			traceId: "trace-global-audit",
			workload: {
				type: "job",
				id: "global-policy-worker",
				name: "Global policy worker",
			},
			actor: {
				kind: "agent",
				subjectId: "audit-agent",
				credentialId: "credential-1",
				issuer: "https://agents.example.com",
				scopes: ["crdt:read"],
				expiresAt: new Date(Date.now() + 60_000),
			},
		} as any);

		await setup.app.globals.policySettings.update({ title: "Draft" }, ctx);
		await setup.app.globals.policySettings.transitionStage(
			{ stage: "published" },
			ctx,
		);

		const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
			{
				where: { resource: "policy_settings" },
				sort: { createdAt: "asc" },
			},
			ctx,
		);

		expect(logs.docs).toHaveLength(2);
		for (const event of logs.docs) {
			expect(event.metadata).toMatchObject({
				actorType: "agent",
				actorId: "audit-agent",
				requestId: "req-global-audit",
				traceId: "trace-global-audit",
				workloadType: "job",
				workloadId: "global-policy-worker",
				workloadName: "Global policy worker",
			});
		}
	});

	it("classifies global field changes", async () => {
		const ctx = createTestContext({ accessMode: "system" });
		await setup.app.globals.policySettings.update(
			{
				title: "Before",
				privateNote: "old-private",
				internalMemo: "old-internal",
			},
			ctx,
		);
		await setup.app.globals.policySettings.update(
			{
				title: "After",
				privateNote: "new-private",
				internalMemo: "new-internal",
			},
			ctx,
		);

		const logs = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
			{ where: { resource: "policy_settings", action: "update" } },
			ctx,
		);
		const changes = logs.docs.find((event) => event.changes)?.changes;
		expect(changes).toMatchObject({
			title: { from: "Before", to: "After" },
			privateNote: { from: REDACTED_VALUE, to: REDACTED_VALUE },
		});
		expect(changes).not.toHaveProperty("internalMemo");
	});

	it("UC-AUD-005 F08 skips destructive cleanup when retention is disabled", async () => {
		let deleteCalls = 0;
		await auditCleanupJob.handler({
			payload: { retentionDays: 90 },
			db: { execute: async () => (deleteCalls++, { rowCount: 1 }) },
			app: { state: { config: { audit: { retention: { days: null } } } } },
		} as any);

		expect(deleteCalls).toBe(0);
	});

	it("UC-AUD-005 F08 preserves audit events selected by legal hold", async () => {
		const expiredEvents = [
			{ id: "held-event", metadata: { caseId: "legal-case-1" } },
			{ id: "expired-event", metadata: null },
		];
		const evaluatedIds: string[] = [];
		const executedStatements: unknown[] = [];
		const cleanupDb = {
			execute: async (statement: unknown) => {
				executedStatements.push(statement);
				return executedStatements.length === 1
					? { rows: expiredEvents }
					: { rowCount: 1 };
			},
			transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
				fn(cleanupDb),
		};
		await auditCleanupJob.handler({
			payload: { retentionDays: 90 },
			db: cleanupDb,
			app: {
				state: {
					config: {
						audit: {
							retention: {
								days: 90,
								legalHold: (event: { id: string }) => {
									evaluatedIds.push(event.id);
									return event.id === "held-event";
								},
							},
						},
					},
				},
			},
		} as any);

		expect(evaluatedIds).toEqual(["held-event", "expired-event"]);
		expect(executedStatements).toHaveLength(2);
		expect(JSON.stringify(executedStatements[0])).toContain(
			"FOR UPDATE SKIP LOCKED",
		);
		const deleteStatement = JSON.stringify(executedStatements[1]);
		expect(deleteStatement).toContain("expired-event");
		expect(deleteStatement).not.toContain("held-event");
	});

	it("preserves held rows and deletes only expired unheld rows in real PGlite", async () => {
		const heldId = crypto.randomUUID();
		const expiredId = crypto.randomUUID();
		const recentId = crypto.randomUUID();
		const expiredAt = new Date("2020-01-01T00:00:00.000Z");
		const recentAt = new Date();

		for (const [id, createdAt] of [
			[heldId, expiredAt],
			[expiredId, expiredAt],
			[recentId, recentAt],
		] as const) {
			await setup.app.db.execute(sql`
				INSERT INTO ${sql.identifier(AUDIT_LOG_COLLECTION)}
					(id, created_at, updated_at, action, "resourceType", resource, title)
				VALUES
					(${id}, ${createdAt}, ${createdAt}, 'update', 'collection', 'policyRecords', 'Retention proof')
			`);
		}

		await auditCleanupJob.handler({
			payload: {},
			db: setup.app.db,
			app: {
				state: {
					config: {
						audit: {
							retention: {
								days: 90,
								legalHold: (event: { id: string }) => event.id === heldId,
							},
						},
					},
				},
			},
		} as any);

		const remaining = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
			{
				where: { id: { in: [heldId, expiredId, recentId] } },
				sort: { id: "asc" },
			},
			createTestContext({ accessMode: "system" }),
		);
		expect(remaining.docs.map((event) => event.id).sort()).toEqual(
			[heldId, recentId].sort(),
		);
	});

	it("UC-AUD-005 F08 delivers one canonical append-only event to the configured sink", async () => {
		const delivered: unknown[] = [];
		await setup.cleanup();
		setup = await buildMockApp({
			collections: { policyRecords },
			modules: [
				auditModuleWith({
					export: {
						delivery: "after-commit",
						sink: { append: (event) => delivered.push(event) },
					},
				}) as any,
			],
			defaultAccess: { read: true, create: true, update: true, delete: true },
		});
		await runTestDbMigrations(setup.app);

		const ctx = createTestContext({ accessMode: "system" });
		await setup.app.collections.policyRecords.create(
			{ id: "sink-event", title: "Export me" },
			ctx,
		);
		const stored = (
			await setup.app.collections[AUDIT_LOG_COLLECTION].find(
				{ where: { resource: "policyRecords", resourceId: "sink-event" } },
				ctx,
			)
		).docs[0];

		expect(delivered).toHaveLength(1);
		expect(stored).toBeDefined();
		expect(delivered[0]).toMatchObject({
			id: stored.id,
			timestamp: stored.createdAt.toISOString(),
			outcome: "succeeded",
			action: "create",
			resource: {
				type: "collection",
				name: "policyRecords",
				id: "sink-event",
			},
			actor: { type: "system", id: expect.any(String) },
		});
	});

	it("never calls an after-commit sink when a later hook rolls the mutation back", async () => {
		const delivered: unknown[] = [];
		await setup.cleanup();
		setup = await buildMockApp({
			collections: { policyRecords },
			modules: [
				auditModuleWith({
					persistence: "required",
					export: {
						sink: { append: (event) => delivered.push(event) },
					},
				}) as any,
			],
			hooks: {
				collections: [
					{
						afterChange: () => {
							throw new Error("later hook failed");
						},
					},
				],
			},
			defaultAccess: { read: true, create: true, update: true, delete: true },
		});
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext({ accessMode: "system" });

		await expect(
			setup.app.collections.policyRecords.create(
				{ id: "later-hook-failure", title: "Must roll back" },
				ctx,
			),
		).rejects.toThrow("later hook failed");
		expect(
			await setup.app.collections.policyRecords.findOne(
				{ where: { id: "later-hook-failure" } },
				ctx,
			),
		).toBeNull();
		const auditRows = await setup.app.collections[AUDIT_LOG_COLLECTION].find(
			{
				where: {
					resource: "policyRecords",
					resourceId: "later-hook-failure",
				},
			},
			ctx,
		);
		expect(auditRows.docs).toHaveLength(0);
		expect(delivered).toHaveLength(0);
	});

	it("keeps the committed mutation and audit row when an after-commit sink fails", async () => {
		await setup.cleanup();
		setup = await buildMockApp({
			collections: { policyRecords },
			modules: [
				auditModuleWith({
					persistence: "required",
					export: {
						sink: {
							append: () => {
								throw new Error("audit sink unavailable");
							},
						},
					},
				}) as any,
			],
			defaultAccess: { read: true, create: true, update: true, delete: true },
		});
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext({ accessMode: "system" });

		const record = await setup.app.collections.policyRecords.create(
			{ id: "best-effort-sink-failure", title: "Still commits" },
			ctx,
		);

		expect(record.id).toBe("best-effort-sink-failure");
		expect(
			await setup.app.collections[AUDIT_LOG_COLLECTION].count({}, ctx),
		).toBe(1);
		expect((ctx.logger as any).getLogsByLevel("error")[0]).toMatchObject({
			args: [
				expect.objectContaining({
					error: expect.objectContaining({
						message: "audit sink unavailable",
					}),
				}),
			],
		});
	});

	it("propagates cleanup failures so the existing queue can retry the job", async () => {
		const cleanupError = new Error("audit cleanup unavailable");
		const failingDb = {
			execute: async () => Promise.reject(cleanupError),
			transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
				fn(failingDb),
		};

		await expect(
			auditCleanupJob.handler({
				payload: {},
				db: failingDb,
				app: {
					state: {
						config: { audit: { retention: { days: 90 } } },
					},
				},
			} as any),
		).rejects.toThrow("audit cleanup unavailable");
	});
});
