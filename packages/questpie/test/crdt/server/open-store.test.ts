import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { Buffer } from "node:buffer";

import { PGlite } from "@electric-sql/pglite";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";

import { CoreNoticeRouter } from "../../../src/server/modules/core/integrated/collaboration/notice-router.js";
import type { CrdtAuthorizationSnapshot } from "../../../src/server/modules/core/integrated/crdt/authorization.js";
import { createCrdtChangeWake } from "../../../src/server/modules/core/integrated/crdt/notice.js";
import {
	createCrdtOpenSessionStore,
	CrdtOpenRejectedError,
} from "../../../src/server/modules/core/integrated/crdt/open-store.js";
import {
	createCrdtRealtimeBindingSource,
	CrdtRealtimeBindingRejectedError,
} from "../../../src/server/modules/core/integrated/crdt/realtime-binding.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtCredentialAdmissionTable,
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
	questpieCrdtSubjectAdmissionTable,
	questpieCrdtTables,
} from "../../../src/server/modules/core/integrated/crdt/schema.js";
import type {
	ChangeBroker,
	ChangeBrokerState,
	ChangeWake,
} from "../../../src/server/modules/core/integrated/realtime/transport.js";

const ID = {
	definition: "00000000-0000-4000-8000-000000000001",
	schema: "00000000-0000-4000-8000-000000000002",
	schemaField: "00000000-0000-4000-8000-000000000003",
	stableField: "00000000-0000-4000-8000-000000000004",
	resource: "00000000-0000-4000-8000-000000000005",
	incarnation: "00000000-0000-4000-8000-000000000006",
	epoch: "00000000-0000-4000-8000-000000000007",
	binding: "00000000-0000-4000-8000-000000000008",
	subject: "00000000-0000-4000-8000-000000000009",
	open: "00000000-0000-4000-8000-000000000010",
} as const;

class RealtimeTestBroker implements ChangeBroker {
	stopCalls = 0;
	private onWake?: (wake: ChangeWake) => void;
	private onStateChange?: (state: ChangeBrokerState) => void;

	async start(input: Parameters<ChangeBroker["start"]>[0]): Promise<void> {
		this.onWake = input.onWake;
		this.onStateChange = input.onStateChange;
	}

	async publish(wake: ChangeWake): Promise<void> {
		this.onWake?.(wake);
	}

	async stop(): Promise<void> {
		this.stopCalls++;
		this.onWake = undefined;
		this.onStateChange = undefined;
	}

	state(state: ChangeBrokerState): void {
		this.onStateChange?.(state);
	}
}

describe("CRDT idempotent open store", () => {
	let ddl: string[];
	let client: PGlite;
	let db: ReturnType<typeof drizzle<typeof questpieCrdtTables>>;

	beforeAll(async () => {
		const { generateDrizzleJson, generateMigration } =
			await import("drizzle-kit/api-postgres");
		const empty = {
			id: "00000000-0000-0000-0000-000000000000",
			dialect: "postgres" as const,
			prevIds: [],
			version: "8" as const,
			ddl: [],
			renames: [],
		};
		ddl = await generateMigration(
			empty,
			await generateDrizzleJson(questpieCrdtTables, empty.id),
		);
	});

	beforeEach(async () => {
		client = await PGlite.create();
		db = drizzle(client, { schema: questpieCrdtTables });
		for (const statement of ddl) {
			if (statement.trim()) await db.execute(sql.raw(statement));
		}
		await seedResource(db);
	});

	afterEach(async () => {
		await client?.close();
	});

	it("returns one logical session for a 100-way lost-response retry race", async () => {
		const store = createCrdtOpenSessionStore(db);
		const input = openInput();
		const results = await Promise.all(
			Array.from({ length: 100 }, () => store.open(input)),
		);

		expect(new Set(results.map((result) => result.sessionId))).toHaveLength(1);
		expect(new Set(results.map((result) => result.bindingId))).toHaveLength(1);
		expect(new Set(results.map((result) => result.deliveryGeneration))).toEqual(
			new Set([1n]),
		);
		const [sessions] = await db
			.select({ value: count() })
			.from(questpieCrdtSessionTable);
		const [grants] = await db
			.select({ value: count() })
			.from(questpieCrdtSessionGrantTable);
		const [subjectAdmission] = await db
			.select({ tokens: questpieCrdtSubjectAdmissionTable.openTokens })
			.from(questpieCrdtSubjectAdmissionTable)
			.where(eq(questpieCrdtSubjectAdmissionTable.subjectId, ID.subject));
		const [credentialAdmission] = await db
			.select({ tokens: questpieCrdtCredentialAdmissionTable.openTokens })
			.from(questpieCrdtCredentialAdmissionTable);
		expect(sessions?.value).toBe(1);
		expect(grants?.value).toBe(1);
		expect(subjectAdmission?.tokens).toBe(29n);
		expect(credentialAdmission?.tokens).toBe(9n);
	});

	it("reattaches the same binding to a new edge generation without duplicating it", async () => {
		const store = createCrdtOpenSessionStore(db);
		const first = await store.open(openInput());
		const second = await store.open(
			openInput({
				edge: {
					sessionKey: bytes(0x82),
					ownerGeneration: 12n,
				},
			}),
		);

		expect(second.sessionId).toBe(first.sessionId);
		expect(second.bindingId).toBe(first.bindingId);
		expect(second.deliveryGeneration).toBe(2n);
		expect(second.edgeOwnerGeneration).toBe(12n);
	});

	it("renews one expired logical open instead of conflicting with its stable openId", async () => {
		const store = createCrdtOpenSessionStore(db);
		const first = await store.open(openInput());
		await db
			.update(questpieCrdtSessionTable)
			.set({
				leaseExpiresAt: new Date(Date.now() - 1_000),
			})
			.where(eq(questpieCrdtSessionTable.id, first.sessionId));

		const renewed = await store.open(openInput());

		expect(renewed.sessionId).toBe(first.sessionId);
		expect(renewed.bindingId).toBe(first.bindingId);
		expect(renewed.deliveryGeneration).toBe(first.deliveryGeneration);
		expect(renewed.leaseExpiresAt.getTime()).toBeGreaterThan(Date.now());
		const [sessions] = await db
			.select({ value: count() })
			.from(questpieCrdtSessionTable);
		expect(sessions?.value).toBe(1);
	});

	it("does not renew an expired logical open past an active session cap", async () => {
		const store = createCrdtOpenSessionStore(db, {
			limits: { maximumSessionsPerSubject: 1 },
		});
		const first = await store.open(openInput());
		await db
			.update(questpieCrdtSessionTable)
			.set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
			.where(eq(questpieCrdtSessionTable.id, first.sessionId));
		await store.open(
			openInput({
				openId: "00000000-0000-4000-8000-000000000019",
			}),
		);

		await expect(store.open(openInput())).rejects.toBeInstanceOf(
			CrdtOpenRejectedError,
		);

		const [stored] = await db
			.select({ leaseExpiresAt: questpieCrdtSessionTable.leaseExpiresAt })
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, first.sessionId));
		expect(stored!.leaseExpiresAt.getTime()).toBeLessThan(Date.now());
	});

	it("atomically retires a replaced logical open before enforcing active session caps", async () => {
		const changes: Array<{ resourceId: string; resourceEpochId: string }> = [];
		const store = createCrdtOpenSessionStore(db, {
			limits: {
				maximumSessionsPerSubject: 1,
				maximumSessionsPerCredential: 1,
			},
			publishChange: async (change) => {
				changes.push(change);
			},
		});
		const first = await store.open(openInput());
		const replacementInput = openInput({
			openId: "00000000-0000-4000-8000-000000000019",
			replacesBindingId: first.bindingId,
		});

		const replacement = await store.open(replacementInput);
		const retried = await store.open(replacementInput);

		expect(replacement.sessionId).not.toBe(first.sessionId);
		expect(replacement.bindingId).not.toBe(first.bindingId);
		expect(retried.sessionId).toBe(replacement.sessionId);
		const sessions = await db
			.select({
				id: questpieCrdtSessionTable.id,
				closedAt: questpieCrdtSessionTable.closedAt,
				closeReason: questpieCrdtSessionTable.closeReason,
			})
			.from(questpieCrdtSessionTable);
		expect(sessions).toHaveLength(2);
		expect(
			sessions.find((session) => session.id === first.sessionId),
		).toMatchObject({ closedAt: expect.any(Date), closeReason: 1 });
		expect(
			sessions.find((session) => session.id === replacement.sessionId),
		).toMatchObject({ closedAt: null, closeReason: null });
		expect(changes).toEqual([
			{ resourceId: ID.resource, resourceEpochId: ID.epoch },
		]);
	});

	it("does not retire another credential's session from a replacement hint", async () => {
		const store = createCrdtOpenSessionStore(db, {
			limits: { maximumSessionsPerSubject: 1 },
		});
		const first = await store.open(openInput());

		await expect(
			store.open(
				openInput({
					openId: "00000000-0000-4000-8000-000000000019",
					replacesBindingId: first.bindingId,
					authorization: authorization({
						credentialFingerprint: bytes(0x72),
					}),
				}),
			),
		).rejects.toBeInstanceOf(CrdtOpenRejectedError);

		const [stored] = await db
			.select({
				closedAt: questpieCrdtSessionTable.closedAt,
				closeReason: questpieCrdtSessionTable.closeReason,
			})
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, first.sessionId));
		expect(stored).toEqual({ closedAt: null, closeReason: null });
		const [sessions] = await db
			.select({ value: count() })
			.from(questpieCrdtSessionTable);
		expect(sessions?.value).toBe(1);
	});

	it("rejects a stale edge owner without rolling the delivery fence back", async () => {
		const store = createCrdtOpenSessionStore(db);
		const first = await store.open(openInput());
		await store.open(
			openInput({
				edge: {
					sessionKey: bytes(0x82),
					ownerGeneration: 20n,
				},
			}),
		);

		await expect(
			store.open(
				openInput({
					edge: {
						sessionKey: bytes(0x83),
						ownerGeneration: 12n,
					},
				}),
			),
		).rejects.toBeInstanceOf(CrdtOpenRejectedError);

		const [stored] = await db
			.select()
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, first.sessionId));
		expect(Buffer.from(stored!.edgeSessionKey!)).toEqual(
			Buffer.from(bytes(0x82)),
		);
		expect(stored!.edgeOwnerGeneration).toBe(20n);
		expect(stored!.deliveryGeneration).toBe(2n);
	});

	it("allows a newer generation of the same full edge without adding a document", async () => {
		const store = createCrdtOpenSessionStore(db, {
			limits: { maximumDocumentsPerEdgeSession: 1 },
		});
		const first = await store.open(openInput());
		const reattached = await store.open(
			openInput({
				edge: {
					sessionKey: bytes(0x81),
					ownerGeneration: 12n,
				},
			}),
		);

		expect(reattached.sessionId).toBe(first.sessionId);
		expect(reattached.deliveryGeneration).toBe(2n);
		expect(reattached.edgeOwnerGeneration).toBe(12n);
	});

	it("rejects a retry whose client-visible manifest changed at the same schema cut", async () => {
		const store = createCrdtOpenSessionStore(db);
		const first = await store.open(openInput());

		await expect(
			store.open(
				openInput({
					authorization: authorization({
						clientManifest: {
							...authorization().clientManifest,
							awarenessEnabled: false,
						},
					}),
				}),
			),
		).rejects.toBeInstanceOf(CrdtOpenRejectedError);

		const [stored] = await db
			.select()
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, first.sessionId));
		expect(stored!.deliveryGeneration).toBe(1n);
	});

	it("binds the authority cut and grants directly to the session", async () => {
		const opened = await createCrdtOpenSessionStore(db).open(openInput());
		const [session] = await db
			.select()
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, opened.sessionId));
		const [grant] = await db
			.select()
			.from(questpieCrdtSessionGrantTable)
			.where(eq(questpieCrdtSessionGrantTable.sessionId, opened.sessionId));

		expect(session).toMatchObject({
			openId: ID.open,
			bindingId: opened.bindingId,
			actorKind: 2,
			resourceId: ID.resource,
			resourceIncarnationKey: ID.incarnation,
			resourceEpochId: ID.epoch,
			aggregateEpoch: 1n,
			schemaId: ID.schema,
			schemaVersion: 1n,
			subjectId: ID.subject,
			generation: 0n,
			deliveryGeneration: 1n,
		});
		expect(grant).toMatchObject({
			resourceId: ID.resource,
			bindingId: ID.binding,
			grant: 1,
		});
	});

	it("fails closed on cross-credential replay and stale authority without mutation", async () => {
		const store = createCrdtOpenSessionStore(db);
		await store.open(openInput());

		const failures = await Promise.allSettled([
			store.open(
				openInput({
					authorization: authorization({
						credentialFingerprint: bytes(0x91),
					}),
				}),
			),
			store.open(
				openInput({
					openId: "00000000-0000-4000-8000-000000000011",
					authorization: authorization({ resourceReadFence: 1n }),
				}),
			),
		]);
		for (const failure of failures) {
			expect(failure.status).toBe("rejected");
			if (failure.status === "rejected") {
				expect(failure.reason).toBeInstanceOf(CrdtOpenRejectedError);
				expect(failure.reason.message).toBe("CRDT unavailable");
			}
		}
		const [sessions] = await db
			.select({ value: count() })
			.from(questpieCrdtSessionTable);
		expect(sessions?.value).toBe(1);
	});

	it("enforces subject, credential, resource, edge and global caps transactionally", async () => {
		const scenarios = [
			{ limit: "maximumSessionsPerSubject", value: 1 },
			{ limit: "maximumSessionsPerCredential", value: 1 },
			{ limit: "maximumSessionsPerResource", value: 1 },
			{ limit: "maximumDocumentsPerEdgeSession", value: 1 },
			{ limit: "maximumSessions", value: 1 },
		] as const;

		for (const [index, scenario] of scenarios.entries()) {
			await db.delete(questpieCrdtSessionGrantTable);
			await db.delete(questpieCrdtSessionTable);
			const store = createCrdtOpenSessionStore(db, {
				limits: { [scenario.limit]: scenario.value },
			});
			await store.open(
				openInput({
					openId: `00000000-0000-4000-8000-${(100 + index * 2)
						.toString()
						.padStart(12, "0")}`,
				}),
			);
			await expect(
				store.open(
					openInput({
						openId: `00000000-0000-4000-8000-${(101 + index * 2)
							.toString()
							.padStart(12, "0")}`,
					}),
				),
			).rejects.toBeInstanceOf(CrdtOpenRejectedError);
			const [sessions] = await db
				.select({ value: count() })
				.from(questpieCrdtSessionTable);
			expect(sessions?.value).toBe(1);
		}
	});

	it("rejects reattachment to a full edge without moving or duplicating the binding", async () => {
		const store = createCrdtOpenSessionStore(db, {
			limits: { maximumDocumentsPerEdgeSession: 1 },
		});
		await store.open(openInput());
		const secondOpenId = "00000000-0000-4000-8000-000000000020";
		const second = await store.open(
			openInput({
				openId: secondOpenId,
				edge: {
					sessionKey: bytes(0x82),
					ownerGeneration: 12n,
				},
			}),
		);

		await expect(
			store.open(
				openInput({
					openId: secondOpenId,
					edge: {
						sessionKey: bytes(0x81),
						ownerGeneration: 11n,
					},
				}),
			),
		).rejects.toBeInstanceOf(CrdtOpenRejectedError);

		const [stored] = await db
			.select()
			.from(questpieCrdtSessionTable)
			.where(eq(questpieCrdtSessionTable.id, second.sessionId));
		expect(Buffer.from(stored!.edgeSessionKey!)).toEqual(
			Buffer.from(bytes(0x82)),
		);
		expect(stored!.deliveryGeneration).toBe(1n);
	});

	it("admits a realtime binding only for its exact live edge key and generation", async () => {
		const opened = await createCrdtOpenSessionStore(db).open(openInput());
		let noticeSubscriptions = 0;
		const source = createCrdtRealtimeBindingSource({
			db,
			namespace: "questpie-test",
			noticeRouter: {
				subscribe: async () => {
					noticeSubscriptions++;
					return async () => {};
				},
			},
		});

		await source.assert({
			bindingId: opened.bindingId,
			edgeSessionKey: bytes(0x81),
			edgeOwnerGeneration: 11n,
		});
		await expect(
			source.assert({
				bindingId: opened.bindingId,
				edgeSessionKey: bytes(0x81),
				edgeOwnerGeneration: 12n,
			}),
		).rejects.toBeInstanceOf(CrdtRealtimeBindingRejectedError);
		expect(noticeSubscriptions).toBe(0);

		const release = await source.subscribe({
			bindingId: opened.bindingId,
			edgeSessionKey: bytes(0x81),
			edgeOwnerGeneration: 11n,
			signal: new AbortController().signal,
			onDirty: () => {},
		});
		expect(noticeSubscriptions).toBe(1);
		await release();

		await expect(
			source.subscribe({
				bindingId: opened.bindingId,
				edgeSessionKey: bytes(0x82),
				edgeOwnerGeneration: 11n,
				signal: new AbortController().signal,
				onDirty: () => {},
			}),
		).rejects.toBeInstanceOf(CrdtRealtimeBindingRejectedError);
		await expect(
			source.subscribe({
				bindingId: opened.bindingId,
				edgeSessionKey: bytes(0x81),
				edgeOwnerGeneration: 12n,
				signal: new AbortController().signal,
				onDirty: () => {},
			}),
		).rejects.toBeInstanceOf(CrdtRealtimeBindingRejectedError);
	});

	it("emits only aggregate-matched readable or awareness dirtiness and fences aborts", async () => {
		const opened = await createCrdtOpenSessionStore(db).open(openInput());
		const broker = new RealtimeTestBroker();
		const router = new CoreNoticeRouter(broker);
		const source = createCrdtRealtimeBindingSource({
			db,
			namespace: "questpie-test",
			noticeRouter: router,
		});
		const controller = new AbortController();
		let dirty = 0;
		let errors = 0;
		await source.subscribe({
			bindingId: opened.bindingId,
			edgeSessionKey: bytes(0x81),
			edgeOwnerGeneration: 11n,
			signal: controller.signal,
			onDirty: () => {
				dirty++;
			},
			onError: () => {
				errors++;
			},
		});
		const wake = (lane: "visible" | "awareness") =>
			createCrdtChangeWake({
				namespace: "questpie-test",
				resourceId: ID.resource,
				resourceEpochId: ID.epoch,
				aggregateEpoch: 1n,
				head: 1n,
				fenceGeneration: 0n,
				reason: "publish",
				lane,
			});

		await broker.publish(wake("visible"));
		await settleTasks();
		expect(dirty).toBe(0);

		await db
			.update(questpieCrdtBindingTable)
			.set({ headFieldCursor: 1n })
			.where(eq(questpieCrdtBindingTable.id, ID.binding));
		await broker.publish(wake("visible"));
		await broker.publish(wake("visible"));
		await settleTasks();
		expect(dirty).toBe(1);

		await broker.publish(wake("awareness"));
		await settleTasks();
		expect(dirty).toBe(2);

		await db
			.update(questpieCrdtSessionTable)
			.set({ closedAt: new Date(), closeReason: 1 })
			.where(eq(questpieCrdtSessionTable.id, opened.sessionId));
		await broker.publish(wake("awareness"));
		await settleTasks();
		expect(dirty).toBe(2);
		expect(errors).toBe(1);

		controller.abort();
		await settleTasks();
		await db
			.update(questpieCrdtBindingTable)
			.set({ headFieldCursor: 2n })
			.where(eq(questpieCrdtBindingTable.id, ID.binding));
		await broker.publish(wake("visible"));
		await settleTasks();
		expect(dirty).toBe(2);
		expect(broker.stopCalls).toBe(1);
	});

	it("reconciles a live CRDT binding when broker connectivity returns", async () => {
		const opened = await createCrdtOpenSessionStore(db).open(openInput());
		const broker = new RealtimeTestBroker();
		const router = new CoreNoticeRouter(broker);
		const source = createCrdtRealtimeBindingSource({
			db,
			namespace: "questpie-test",
			noticeRouter: router,
		});
		const controller = new AbortController();
		let dirty = 0;
		const release = await source.subscribe({
			bindingId: opened.bindingId,
			edgeSessionKey: bytes(0x81),
			edgeOwnerGeneration: 11n,
			signal: controller.signal,
			onDirty: () => {
				dirty++;
			},
		});

		broker.state("connected");
		await settleTasks();
		expect(dirty).toBe(1);

		controller.abort();
		await release();
	});

	it("reconciles a CRDT binding when its bounded broker queue overflows", async () => {
		const opened = await createCrdtOpenSessionStore(db).open(openInput());
		const broker = new RealtimeTestBroker();
		const router = new CoreNoticeRouter(broker, {
			maxSubscriberItems: 1,
			maxSubscriberBytes: 1024,
		});
		const source = createCrdtRealtimeBindingSource({
			db,
			namespace: "questpie-test",
			noticeRouter: router,
		});
		let unblock!: () => void;
		let markStarted!: () => void;
		const blocked = new Promise<void>((resolve) => {
			unblock = resolve;
		});
		const started = new Promise<void>((resolve) => {
			markStarted = resolve;
		});
		let dirty = 0;
		const release = await source.subscribe({
			bindingId: opened.bindingId,
			edgeSessionKey: bytes(0x81),
			edgeOwnerGeneration: 11n,
			signal: new AbortController().signal,
			onDirty: async () => {
				dirty++;
				if (dirty !== 1) return;
				markStarted();
				await blocked;
			},
		});
		const wake = createCrdtChangeWake({
			namespace: "questpie-test",
			resourceId: ID.resource,
			resourceEpochId: ID.epoch,
			aggregateEpoch: 1n,
			head: 1n,
			fenceGeneration: 0n,
			reason: "publish",
			lane: "awareness",
		});

		await broker.publish(wake);
		await started;
		await broker.publish({ ...wake, head: 2 });
		await broker.publish({ ...wake, head: 3 });
		await settleTasks();
		expect(dirty).toBe(2);

		unblock();
		await release();
	});
});

function openInput(
	overrides: Partial<{
		openId: string;
		replacesBindingId: string;
		authorization: CrdtAuthorizationSnapshot;
		edge: { sessionKey: Uint8Array; ownerGeneration: bigint };
	}> = {},
) {
	return {
		openId: overrides.openId ?? ID.open,
		...(overrides.replacesBindingId
			? { replacesBindingId: overrides.replacesBindingId }
			: {}),
		authorization: overrides.authorization ?? authorization(),
		actorKind: 2 as const,
		edge: overrides.edge ?? {
			sessionKey: bytes(0x81),
			ownerGeneration: 11n,
		},
	};
}

function authorization(
	overrides: Partial<CrdtAuthorizationSnapshot> = {},
): CrdtAuthorizationSnapshot {
	return {
		resourceId: ID.resource,
		resourceEpochId: ID.epoch,
		definitionId: ID.definition,
		schemaId: ID.schema,
		incarnationKey: ID.incarnation,
		subjectId: ID.subject,
		credentialFingerprint: bytes(0x71),
		audience: "questpie-test",
		origin: "https://app.example",
		requestedMode: "edit",
		effectiveMode: "edit",
		resourceReadFence: 0n,
		resourceEditFence: 0n,
		subjectReadFence: 0n,
		subjectEditFence: 0n,
		ownerPolicyRevision: 0n,
		sessionGeneration: 0n,
		authorityExpiresAt: new Date(Date.now() + 60_000),
		headCommitSeq: 0n,
		offlineSubjectKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		clientManifest: {
			schemaVersion: 1,
			schemaFingerprint: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBA",
			awarenessEnabled: true,
			fields: {
				title: {
					fieldSlot: 1,
					format: "text",
					formatVersion: 1,
					engineId: "test-text",
					grant: "edit",
				},
			},
		},
		bindings: [
			{
				bindingId: ID.binding,
				stableFieldId: ID.stableField,
				fieldEpoch: 0n,
				fieldSlot: 1,
				formatVersion: 1,
				headFieldCursor: 0n,
				fieldReadFence: 0n,
				fieldEditFence: 0n,
			},
		],
		grants: [
			{
				bindingId: ID.binding,
				stableFieldId: ID.stableField,
				fieldEpoch: 0n,
				fieldSlot: 1,
				formatVersion: 1,
				grant: "edit",
				headFieldCursor: 0n,
				fieldReadFence: 0n,
				fieldEditFence: 0n,
				subjectFieldReadFence: 0n,
				subjectFieldEditFence: 0n,
			},
		],
		...overrides,
	};
}

async function seedResource(
	db: ReturnType<typeof drizzle<any>>,
): Promise<void> {
	await db.execute(sql`
		INSERT INTO questpie_crdt_namespace (singleton, namespace)
		VALUES (1, 'questpie-test')
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_definition
			(id, namespace_singleton, owner_kind, owner_key, identity_version)
		VALUES (${ID.definition}, 1, 1, 'articles', 1)
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_schema
			(id, definition_id, schema_version, schema_fingerprint)
		VALUES (${ID.schema}, ${ID.definition}, 1, decode(repeat('11', 32), 'hex'))
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_schema_field
			(id, definition_id, schema_id, stable_field_id, field_slot, source_path, format, format_version, codec_fingerprint)
		VALUES (${ID.schemaField}, ${ID.definition}, ${ID.schema}, ${ID.stableField}, 1, 'title', 1, 1, decode(repeat('12', 32), 'hex'))
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_resource
			(id, incarnation_key, definition_id, locator, locator_hash, identity_version, status)
		VALUES (${ID.resource}, ${ID.incarnation}, ${ID.definition}, '{"id":"article-1"}', decode(repeat('13', 32), 'hex'), 1, 3)
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_resource_epoch
			(id, resource_id, definition_id, aggregate_epoch, schema_id, status)
		VALUES (${ID.epoch}, ${ID.resource}, ${ID.definition}, 1, ${ID.schema}, 1)
	`);
	await db.execute(sql`
		UPDATE questpie_crdt_resource
		SET status = 1, current_epoch_id = ${ID.epoch}, current_epoch_status = 1
		WHERE id = ${ID.resource}
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_binding
			(id, resource_id, definition_id, schema_id, schema_field_id, stable_field_id, field_slot, source_path, format, format_version, field_epoch, canonical_hash, projected_canonical_hash, status)
		VALUES (${ID.binding}, ${ID.resource}, ${ID.definition}, ${ID.schema}, ${ID.schemaField}, ${ID.stableField}, 1, 'title', 1, 1, 0, decode(repeat('14', 32), 'hex'), decode(repeat('14', 32), 'hex'), 1)
	`);
	await db.execute(sql`
		INSERT INTO questpie_crdt_subject
			(id, kind, issuer_key, subject_key, subject_hash)
		VALUES (${ID.subject}, 1, '', 'user-1', decode(repeat('15', 32), 'hex'))
	`);
}

function bytes(value: number): Uint8Array {
	return new Uint8Array(32).fill(value);
}

async function settleTasks(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
