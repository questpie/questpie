import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import type { Questpie } from "#questpie/server/config/questpie.js";

import { createCrdtCompactionStore } from "./compaction-store.js";
import {
	createCrdtServerOperations,
	type CrdtServerOperationsConfig,
} from "./crdt-operations.js";
import { createDeterministicSetEngine } from "./deterministic-engine.js";
import { createCrdtChangeWake } from "./notice.js";
import { createCrdtOperationalCoordinator } from "./operational-coordinator.js";
import {
	createCrdtExactCutProjectionMaterializer,
	createCrdtProjectionStore,
} from "./projection-store.js";
import { createQuestpieProjectionOwnerPort } from "./questpie-projection-owner.js";
import { createQuestpieReplaceOwnerPort } from "./questpie-replace-owner.js";
import { createCrdtReplaceStore } from "./replace-store.js";
import {
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
} from "./schema.js";
import { createCrdtDrainCoordinator } from "./sync-coordinator.js";
import type { CrdtSyncCoordinatorRegistration } from "./sync-socket.js";

export type QuestpieCrdtOperationalService = Readonly<{
	available: boolean;
	syncCoordinator: CrdtSyncCoordinatorRegistration | null;
	createRequestOperations(input: {
		context: CRUDContext;
		authorize: CrdtServerOperationsConfig["authorize"];
	}): ReturnType<typeof createCrdtServerOperations>;
	wake(): void;
	stop(): Promise<void>;
}>;

export async function createQuestpieCrdtOperationalService(
	app: Questpie<any>,
): Promise<QuestpieCrdtOperationalService> {
	const runtime = app.config.crdt;
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
		return createUnavailableQuestpieCrdtOperationalService();
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
	const publishNotice = async (notice: {
		resourceId: string;
		resourceEpochId: string;
		commitSeq: bigint;
	}) => {
		coordinator.wake();
		const [identity] = await app.db
			.select({
				aggregateEpoch: questpieCrdtResourceEpochTable.aggregateEpoch,
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
				head: notice.commitSeq,
				fenceGeneration: identity.fenceGeneration,
				reason: "publish",
			}),
		);
	};
	const projection = createCrdtProjectionStore(app.db, {
		owner: createQuestpieProjectionOwnerPort(app),
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
				await compaction.runOnce();
				if (!signal.aborted) await compaction.collectExpired();
			},
		},
		onError(error, operation) {
			app.logger.error(`[QUESTPIE CRDT] ${operation} runner failed`, error);
		},
	});
	const drainCoordinator = createCrdtDrainCoordinator({
		router: app.realtime.noticeRouter,
		onOperationalWake: () => coordinator.wake(),
		onError(error) {
			app.logger.error("[QUESTPIE CRDT] sync drain failed", error);
		},
	});
	await drainCoordinator.start();
	coordinator.start();

	return Object.freeze({
		available: true,
		syncCoordinator: drainCoordinator,
		createRequestOperations({ authorize }) {
			return createCrdtServerOperations({
				db: app.db,
				replace,
				owners: app.crdtRegistry,
				authorize,
			});
		},
		wake: coordinator.wake,
		async stop() {
			await coordinator.stop();
			await drainCoordinator.stop();
		},
	});
}

export function createUnavailableQuestpieCrdtOperationalService(): QuestpieCrdtOperationalService {
	const unavailable = Object.freeze({
		collections: Object.freeze({}),
		globals: Object.freeze({}),
		async withAuthorityMutation() {
			throw new Error("CRDT runtime is unavailable");
		},
	}) as ReturnType<typeof createCrdtServerOperations>;
	return Object.freeze({
		available: false,
		syncCoordinator: null,
		createRequestOperations() {
			return unavailable;
		},
		wake() {},
		async stop() {},
	});
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
