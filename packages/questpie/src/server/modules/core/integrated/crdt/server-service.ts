import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { createAdapterContextForOAuthAudience } from "#questpie/server/adapters/utils/context.js";
import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import type { Questpie } from "#questpie/server/config/questpie.js";
import { questpieApiAudienceForApp } from "#questpie/server/modules/core/integrated/auth/api-audience.js";

import { createCrdtCompactionStore } from "./compaction-store.js";
import type { CrdtRuntimeConfig } from "./config.js";
import {
	createCrdtServerOperations,
	type CrdtServerOperationsConfig,
} from "./crdt-operations.js";
import { createDeterministicSetEngine } from "./deterministic-engine.js";
import { createCrdtExchangeApplicationV1 } from "./exchange-application.js";
import { createCrdtChangeWake } from "./notice.js";
import { createCrdtOpenApplicationV1 } from "./open-application.js";
import { createCrdtOpenSessionStore } from "./open-store.js";
import { createCrdtOperationalCoordinator } from "./operational-coordinator.js";
import { createCrdtDatabasePresenceStore } from "./presence-store.js";
import {
	createCrdtExactCutProjectionMaterializer,
	createCrdtProjectionStore,
} from "./projection-store.js";
import { createCrdtPullStore } from "./pull-store.js";
import { createQuestpieCrdtAuthorizationResolverV1 } from "./questpie-authorization.js";
import { createQuestpieProjectionOwnerPort } from "./questpie-projection-owner.js";
import { createQuestpieReplaceOwnerPort } from "./questpie-replace-owner.js";
import { createCrdtRealtimeBindingSource } from "./realtime-binding.js";
import { createCrdtReplaceStore } from "./replace-store.js";
import {
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
} from "./schema.js";
import {
	inspectCrdtExchangeSession,
	validateCrdtExchangeAuthority,
} from "./session-authority.js";
import { createCrdtDatabaseSyncSource } from "./sync-store.js";

export type QuestpieCrdtOperationalService = Readonly<{
	available: boolean;
	createRequestOperations(input: {
		context: CRUDContext;
		authorize: CrdtServerOperationsConfig["authorize"];
	}): ReturnType<typeof createCrdtServerOperations>;
	handleOpen(request: Request): Promise<Response>;
	handleExchange(request: Request): Promise<Response>;
	assertRealtimeBinding: ReturnType<
		typeof createCrdtRealtimeBindingSource
	>["assert"];
	subscribeRealtimeBinding: ReturnType<
		typeof createCrdtRealtimeBindingSource
	>["subscribe"];
	wake(): void;
	stop(): Promise<void>;
}>;

export async function createQuestpieCrdtOperationalService(
	app: Questpie<any>,
): Promise<QuestpieCrdtOperationalService> {
	const runtime = app.config.crdt;
	const stopEngines = createCrdtEngineShutdown(runtime?.engines);
	const ownerCount =
		Object.keys(app.crdtRegistry.collections).length +
		Object.keys(app.crdtRegistry.globals).length;
	const textEngine = runtime?.engines?.text;
	const requiresText = [
		...Object.values(app.crdtRegistry.collections),
		...Object.values(app.crdtRegistry.globals),
	].some((owner) =>
		Object.values(owner.fields).some((field) => field.format === "text"),
	);
	if (
		!runtime ||
		ownerCount === 0 ||
		(requiresText && !textEngine) ||
		Object.keys(app.crdtManifests.collections).length +
			Object.keys(app.crdtManifests.globals).length ===
			0
	) {
		return createUnavailableQuestpieCrdtOperationalService(runtime?.engines);
	}
	const secret = app.config.secret;
	if (typeof secret !== "string" || secret.length < 16) {
		return createUnavailableQuestpieCrdtOperationalService(runtime?.engines);
	}
	const setEngine = createDeterministicSetEngine();
	const resolveEngine = (binding: {
		format: number;
		formatVersion: number;
	}) => {
		const engine = binding.format === 1 ? textEngine : setEngine;
		if (!engine || engine.formatVersion !== binding.formatVersion) {
			throw new Error("CRDT engine is unavailable or incompatible");
		}
		return engine as any;
	};
	let coordinator: ReturnType<typeof createCrdtOperationalCoordinator>;
	let stopPromise: Promise<void> | undefined;
	const publishCrdtWake = async (
		notice: {
			resourceId: string;
			resourceEpochId: string;
			head?: bigint;
		},
		reason: "publish" | "reconcile",
		wakeOperational: boolean,
		lane: "visible" | "awareness" = "visible",
	) => {
		if (wakeOperational) coordinator.wake();
		const [identity] = await app.db
			.select({
				aggregateEpoch: questpieCrdtResourceEpochTable.aggregateEpoch,
				headCommitSeq: questpieCrdtResourceEpochTable.headCommitSeq,
				fenceGeneration: questpieCrdtResourceTable.sessionGeneration,
			})
			.from(questpieCrdtResourceEpochTable)
			.innerJoin(
				questpieCrdtResourceTable,
				eq(
					questpieCrdtResourceTable.id,
					questpieCrdtResourceEpochTable.resourceId,
				),
			)
			.where(
				and(
					eq(questpieCrdtResourceEpochTable.id, notice.resourceEpochId),
					eq(questpieCrdtResourceEpochTable.resourceId, notice.resourceId),
				),
			);
		if (!identity) return;
		await app.realtime.noticeRouter.publish(
			createCrdtChangeWake({
				namespace: runtime.namespace,
				resourceId: notice.resourceId,
				resourceEpochId: notice.resourceEpochId,
				aggregateEpoch: identity.aggregateEpoch,
				head: notice.head ?? identity.headCommitSeq,
				fenceGeneration: identity.fenceGeneration,
				reason,
				lane,
			}),
		);
	};
	const publishNotice = async (notice: {
		resourceId: string;
		resourceEpochId: string;
		commitSeq: bigint;
	}) => publishCrdtWake({ ...notice, head: notice.commitSeq }, "publish", true);
	const projectionOwner = createQuestpieProjectionOwnerPort(app);
	const syncSource = createCrdtDatabaseSyncSource(app.db, {
		resolveEngine,
		async lockOwnerRow(transaction, identity) {
			await projectionOwner.lock(transaction, {
				resourceId: identity.resourceId,
			});
			return identity;
		},
		publishNotice,
	});
	const audience = questpieApiAudienceForApp(app);
	const deploymentFingerprint = createHash("sha256")
		.update("questpie-crdt-deployment-v1\0")
		.update(runtime.namespace)
		.update("\0")
		.update(audience)
		.digest("base64url");
	const pullStore = createCrdtPullStore(app.db, {
		namespace: runtime.namespace,
		deploymentFingerprint,
		secret,
		resolveEngine,
	});
	const realtimeBindings = createCrdtRealtimeBindingSource({
		db: app.db,
		namespace: runtime.namespace,
		noticeRouter: app.realtime.noticeRouter,
	});
	const participantSecret = createHash("sha256")
		.update("questpie-crdt-participant-key-v1\0")
		.update(secret)
		.digest();
	const presenceSource = createCrdtDatabasePresenceStore(app.db, {
		participantSecret,
		isAwarenessEnabled({ ownerKind, ownerKey }) {
			return Boolean(
				(ownerKind === "collection"
					? app.crdtRegistry.collections[ownerKey]
					: app.crdtRegistry.globals[ownerKey]
				)?.awarenessSchema,
			);
		},
		parseAwareness({ ownerKind, ownerKey, value }) {
			const owner =
				ownerKind === "collection"
					? app.crdtRegistry.collections[ownerKey]
					: app.crdtRegistry.globals[ownerKey];
			const schema = owner?.awarenessSchema as
				| {
						safeParse(
							value: unknown,
						): { success: true; data: unknown } | { success: false };
				  }
				| undefined;
			if (!schema) throw new Error("CRDT awareness is disabled");
			const parsed = schema.safeParse(value);
			if (!parsed.success) throw new Error("CRDT awareness is invalid");
			return parsed.data;
		},
		publishChange: (notice) =>
			publishCrdtWake(notice, "reconcile", false, "awareness"),
	});
	const projection = createCrdtProjectionStore(app.db, {
		owner: projectionOwner,
		materializeExactCut: createCrdtExactCutProjectionMaterializer({
			resolveEngine,
		}),
		publishNotice,
	});
	const replace = createCrdtReplaceStore(app.db, {
		owner: createQuestpieReplaceOwnerPort(app),
		engines: {
			...(textEngine ? { text: textEngine } : {}),
			set: setEngine,
		} as any,
		publishNotice,
	});
	const compaction = createCrdtCompactionStore(app.db, {
		ownerId: `questpie:${randomUUID()}`,
		resolveEngine,
	});
	coordinator = createCrdtOperationalCoordinator({
		available: true,
		projection: {
			async runDue({ signal }) {
				return drainCrdtProjection(projection, signal);
			},
		},
		maintenance: {
			async runDue({ signal }) {
				if (signal.aborted) return;
				await pullStore.collectExpired();
				if (!signal.aborted) await compaction.runOnce();
				if (!signal.aborted) await compaction.collectExpired();
			},
		},
		onError(error, operation) {
			app.logger.error(`[QUESTPIE CRDT] ${operation} runner failed`, error);
		},
	});
	coordinator.start();
	const requestContexts = new WeakMap<Request, CRUDContext>();
	const authorizeOpen = createQuestpieCrdtAuthorizationResolverV1(
		app,
		requestContexts,
	);
	const openStore = createCrdtOpenSessionStore(app.db, {
		publishChange: (change) =>
			publishCrdtWake(change, "publish", false, "awareness"),
	});
	const openApplication = createCrdtOpenApplicationV1({
		namespace: runtime.namespace,
		deploymentFingerprint,
		appUrl: app.config.app.url,
		allowedOrigins: runtime.allowedOrigins,
		audience,
		authenticateBrowser: async (request) => {
			requestContexts.delete(request);
			const adapter = await createAdapterContextForOAuthAudience(
				app,
				request,
				{ accessMode: "user" },
				audience,
			);
			const principal = adapter.appContext.principal;
			if (
				!principal ||
				(principal.kind !== "user" && principal.kind !== "oauth")
			) {
				return null;
			}
			if (principal.kind === "oauth" && !principal.tokenId) {
				throw new Error("CRDT OAuth credential requires a stable token id");
			}
			requestContexts.set(request, adapter.appContext as CRUDContext);
			return principal;
		},
		authenticateAgent: async (input) =>
			(await runtime.authenticateAgent?.(input)) ?? null,
		authorize: authorizeOpen,
		authorizeEdge: async (input) => {
			const edge = await app.realtime.authorizeTopologySession(input);
			if (!edge) return null;
			return {
				sessionKey: Buffer.from(edge.sessionKey, "hex"),
				ownerGeneration: BigInt(edge.ownerGeneration),
			};
		},
		openSession: openStore.open,
	});
	const exchangeRequestContexts = new WeakMap<Request, CRUDContext>();
	const authorizeExchange = createQuestpieCrdtAuthorizationResolverV1(
		app,
		exchangeRequestContexts,
	);
	const exchangeApplication = createCrdtExchangeApplicationV1({
		namespace: runtime.namespace,
		appUrl: app.config.app.url,
		allowedOrigins: runtime.allowedOrigins,
		audience,
		authenticateBrowser: async (request) => {
			exchangeRequestContexts.delete(request);
			const adapter = await createAdapterContextForOAuthAudience(
				app,
				request,
				{ accessMode: "user" },
				audience,
			);
			const principal = adapter.appContext.principal;
			if (
				!principal ||
				(principal.kind !== "user" && principal.kind !== "oauth")
			) {
				return null;
			}
			if (principal.kind === "oauth" && !principal.tokenId) {
				throw new Error("CRDT OAuth credential requires a stable token id");
			}
			exchangeRequestContexts.set(request, adapter.appContext as CRUDContext);
			return principal;
		},
		authenticateAgent: async (input) =>
			(await runtime.authenticateAgent?.(input)) ?? null,
		inspectSession: (input) => inspectCrdtExchangeSession(app.db, input),
		authorize: authorizeExchange,
		validateAuthority: (claim, authorization, options) =>
			validateCrdtExchangeAuthority(app.db, claim, authorization, options),
		pull: pullStore.pull,
		sync: syncSource,
		presence: presenceSource,
	});

	return Object.freeze({
		available: true,
		createRequestOperations({ authorize }) {
			return createCrdtServerOperations({
				db: app.db,
				replace,
				owners: app.crdtRegistry,
				authorize,
			});
		},
		handleOpen: openApplication.handle,
		handleExchange: exchangeApplication.handle,
		assertRealtimeBinding: realtimeBindings.assert,
		subscribeRealtimeBinding: realtimeBindings.subscribe,
		wake: coordinator.wake,
		stop() {
			return stopOnce();
		},
	});

	function stopOnce() {
		stopPromise ??= (async () => {
			try {
				await coordinator.stop();
			} finally {
				await stopEngines();
			}
		})();
		return stopPromise;
	}
}

export function createUnavailableQuestpieCrdtOperationalService(
	engines?: CrdtRuntimeConfig["engines"],
): QuestpieCrdtOperationalService {
	const unavailable = Object.freeze({
		collections: Object.freeze({}),
		globals: Object.freeze({}),
		async withAuthorityMutation() {
			throw new Error("CRDT runtime is unavailable");
		},
	}) as ReturnType<typeof createCrdtServerOperations>;
	return Object.freeze({
		available: false,
		createRequestOperations() {
			return unavailable;
		},
		async handleOpen() {
			return Response.json(
				{
					error: {
						code: "CRDT_UNAVAILABLE",
						message: "CRDT unavailable",
					},
				},
				{ status: 404, headers: { "cache-control": "no-store" } },
			);
		},
		async handleExchange() {
			return Response.json(
				{
					error: {
						code: "CRDT_UNAVAILABLE",
						message: "CRDT unavailable",
					},
				},
				{ status: 404, headers: { "cache-control": "no-store" } },
			);
		},
		async assertRealtimeBinding() {
			throw new Error("CRDT runtime is unavailable");
		},
		async subscribeRealtimeBinding() {
			throw new Error("CRDT runtime is unavailable");
		},
		wake() {},
		stop: createCrdtEngineShutdown(engines),
	});
}

function createCrdtEngineShutdown(
	engines?: CrdtRuntimeConfig["engines"],
): () => Promise<void> {
	const disposableEngines = [
		...new Set(
			Object.values(engines ?? {}).filter((engine) => engine?.dispose),
		),
	];
	let shutdown: Promise<void> | undefined;
	return () => {
		shutdown ??= Promise.all(
			disposableEngines.map((engine) =>
				Promise.resolve().then(() => engine!.dispose!()),
			),
		).then(() => undefined);
		return shutdown;
	};
}

const MAX_PROJECTION_DRAIN_BATCH = 64;

export async function drainCrdtProjection(
	projection: Readonly<{ runOnce(): Promise<unknown | null> }>,
	signal: AbortSignal,
) {
	for (let index = 0; index < MAX_PROJECTION_DRAIN_BATCH; index++) {
		if (signal.aborted) return { nextDueAt: null };
		const result = await projection.runOnce();
		if (result === null) return { nextDueAt: null };
	}
	// Yield to the event loop, then immediately continue a bounded backlog.
	return { nextDueAt: new Date() };
}
