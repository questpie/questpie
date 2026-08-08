import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection, global, runWithContext } from "questpie";
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

const policyRecords = collection("policy_records").fields(({ f }) => ({
	title: f.text().required().set("audit", "include"),
	privateNote: f.text().set("audit", "redact"),
	internalMemo: f.text().set("audit", "omit"),
	password: f.text(),
	accessToken: f.text(),
}));

const policySettings = global("policy_settings").fields(({ f }) => ({
	title: f.text().set("audit", "include"),
	privateNote: f.text().set("audit", "redact"),
	internalMemo: f.text().set("audit", "omit"),
}));

const authorizedAuditLog = collection("admin_audit_log")
	.merge(auditLogCollection)
	.access({
		read: ({ session }) => session?.user?.id === "auditor-1",
		create: false,
		update: false,
		delete: false,
	});

type AuditPolicy = {
	delivery?: "best-effort" | "required";
	retention?: { days: number | null; legalHold?: (event: unknown) => boolean };
	sink?: { append: (event: unknown) => Promise<void> | void };
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

interface AuditCrud {
	create(...args: unknown[]): Promise<unknown>;
}

interface AuditCollectionDefinition {
	generateCRUD(...args: unknown[]): AuditCrud;
}

interface AuditTestApp {
	getCollections(): Record<string, AuditCollectionDefinition>;
}

function failAuditWrites(app: AuditTestApp): () => void {
	const definition = app.getCollections()[AUDIT_LOG_COLLECTION];
	const originalGenerateCRUD = definition.generateCRUD.bind(definition);
	definition.generateCRUD = (...args: unknown[]) => {
		const crud = originalGenerateCRUD(...args);
		crud.create = async () => {
			throw new Error("audit store unavailable");
		};
		return crud;
	};
	return () => {
		definition.generateCRUD = originalGenerateCRUD;
	};
}

describe("audit policy contract", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

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

	it("UC-AUD-001 F04 denies anonymous reads of the audit collection by default", async () => {
		const handler = createFetchHandler(setup.app, { basePath: "/api" });
		const response = await handler(
			new Request(`http://localhost/api/${AUDIT_LOG_COLLECTION}`),
		);

		expect(response.status).toBe(403);
	});

	it("UC-AUD-001 permits an application to grant audit reads explicitly", async () => {
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

	it("UC-AUD-003 F06 rolls back a protected mutation when required audit delivery fails", async () => {
		await setup.cleanup();
		setup = await buildMockApp({
			collections: { policyRecords },
			modules: [auditModuleWith({ delivery: "required" }) as any],
			defaultAccess: { read: true, create: true, update: true, delete: true },
		});
		await runTestDbMigrations(setup.app);

		const restoreAuditWrites = failAuditWrites(setup.app);
		const ctx = createTestContext({ accessMode: "system" });

		let mutationError: unknown;
		try {
			await setup.app.collections.policyRecords.create(
				{ id: "required-failure", title: "Must roll back" },
				ctx,
			);
		} catch (error) {
			mutationError = error;
		} finally {
			restoreAuditWrites();
		}

		expect(mutationError).toBeInstanceOf(Error);
		expect(String(mutationError)).toContain("audit store unavailable");
		expect(
			await setup.app.collections.policyRecords.findOne(
				{ where: { id: "required-failure" } },
				ctx,
			),
		).toBeNull();
	});

	it("UC-AUD-003 F07 commits and emits a structured error when best-effort audit delivery fails", async () => {
		const restoreAuditWrites = failAuditWrites(setup.app);
		const ctx = createTestContext({ accessMode: "system" });

		const record = await setup.app.collections.policyRecords.create(
			{ id: "best-effort-failure", title: "Still commits" },
			ctx,
		);
		restoreAuditWrites();

		expect(record.id).toBe("best-effort-failure");
		const failure = (ctx.logger as any).getLogsByLevel("error")[0];
		expect(failure).toMatchObject({
			level: "error",
			message: expect.stringContaining("Failed to log create"),
		});
		expect(failure.args[0]).toMatchObject({
			error: expect.objectContaining({
				message: "audit store unavailable",
			}),
			operation: "create",
			resource: "policyRecords",
		});
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
			app: { state: { audit: { retention: { days: null } } } },
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
		await auditCleanupJob.handler({
			payload: { retentionDays: 90 },
			db: {
				execute: async (statement: unknown) => {
					executedStatements.push(statement);
					return executedStatements.length === 1
						? { rows: expiredEvents }
						: { rowCount: 1 };
				},
			},
			app: {
				state: {
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
		} as any);

		expect(evaluatedIds).toEqual(["held-event", "expired-event"]);
		expect(executedStatements).toHaveLength(2);
		const deleteStatement = JSON.stringify(executedStatements[1]);
		expect(deleteStatement).toContain("expired-event");
		expect(deleteStatement).not.toContain("held-event");
	});

	it("UC-AUD-005 F08 delivers one canonical append-only event to the configured sink", async () => {
		const delivered: unknown[] = [];
		await setup.cleanup();
		setup = await buildMockApp({
			collections: { policyRecords },
			modules: [
				auditModuleWith({
					sink: { append: (event) => delivered.push(event) },
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

	it("fails the mutation when the required append-only sink fails", async () => {
		await setup.cleanup();
		setup = await buildMockApp({
			collections: { policyRecords },
			modules: [
				auditModuleWith({
					delivery: "required",
					sink: {
						append: () => {
							throw new Error("audit sink unavailable");
						},
					},
				}) as any,
			],
			defaultAccess: { read: true, create: true, update: true, delete: true },
		});
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext({ accessMode: "system" });

		await expect(
			setup.app.collections.policyRecords.create(
				{ id: "required-sink-failure", title: "Must roll back" },
				ctx,
			),
		).rejects.toThrow("audit sink unavailable");
		expect(
			await setup.app.collections.policyRecords.findOne(
				{ where: { id: "required-sink-failure" } },
				ctx,
			),
		).toBeNull();
	});

	it("keeps the mutation observable when the best-effort sink fails", async () => {
		await setup.cleanup();
		setup = await buildMockApp({
			collections: { policyRecords },
			modules: [
				auditModuleWith({
					sink: {
						append: () => {
							throw new Error("audit sink unavailable");
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

	it("applies delivery policy to cleanup failures", async () => {
		const cleanupError = new Error("audit cleanup unavailable");
		const failingDb = { execute: async () => Promise.reject(cleanupError) };
		const errors: unknown[] = [];

		await auditCleanupJob.handler({
			payload: {},
			db: failingDb,
			logger: { error: (...args: unknown[]) => errors.push(args) },
			app: {
				state: {
					audit: { retention: { days: 90 }, delivery: "best-effort" },
				},
			},
		} as any);
		expect(errors).toHaveLength(1);

		await expect(
			auditCleanupJob.handler({
				payload: {},
				db: failingDb,
				app: {
					state: {
						audit: { retention: { days: 90 }, delivery: "required" },
					},
				},
			} as any),
		).rejects.toThrow("audit cleanup unavailable");
	});
});
