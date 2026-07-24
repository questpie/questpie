import { createHash } from "node:crypto";

import { eq, getTableColumns } from "drizzle-orm";

import { createAdapterContext } from "#questpie/server/adapters/utils/context.js";
import type { AccessWhere } from "#questpie/server/collection/builder/types.js";
import {
	checkFieldWriteAccess,
	executeAccessRule,
	getRestrictedReadFields,
	matchesAccessConditions,
	mergeFieldAccessRules,
} from "#questpie/server/collection/crud/shared/access-control.js";
import type { CRUDContext } from "#questpie/server/collection/crud/types.js";
import type { Principal } from "#questpie/server/config/context.js";
import type { Questpie } from "#questpie/server/config/questpie.js";

import type { CrdtAuthentication } from "./authority.js";
import {
	createCrdtTicketAuthorizationResolverV1,
	type CrdtResolvedOwnerV1,
} from "./authorization-resolver.js";
import { createCrdtHostApplicationV1 } from "./host-application.js";
import type { CrdtSyncCoordinatorRegistration } from "./sync-socket.js";
import { createCrdtTicketAdmissionStore } from "./ticket-store.js";

type QuestpieCrdtOpenSessionInput = Parameters<
	typeof createCrdtHostApplicationV1
>[0]["openAuthenticatedSession"] extends (
	input: infer TInput,
) => Promise<unknown>
	? TInput
	: never;

export type QuestpieCrdtHostApplicationConfigV1 = Readonly<{
	audience: string;
	openAuthenticatedSession(
		input: QuestpieCrdtOpenSessionInput & {
			coordinator: CrdtSyncCoordinatorRegistration;
		},
	): ReturnType<
		Parameters<
			typeof createCrdtHostApplicationV1
		>[0]["openAuthenticatedSession"]
	>;
	authenticateBrowser?: (
		request: Request,
	) => Promise<Extract<Principal, { kind: "user" | "oauth" }> | null>;
}>;

export function createQuestpieCrdtHostApplicationV1(
	app: Questpie<any>,
	config: QuestpieCrdtHostApplicationConfigV1,
) {
	const runtime = app.config.crdt;
	if (!runtime) {
		throw new TypeError("QUESTPIE CRDT host requires runtimeConfig({ crdt })");
	}
	const secret = app.config.secret;
	if (typeof secret !== "string" || secret.length === 0) {
		throw new TypeError("QUESTPIE CRDT host requires an application secret");
	}
	const syncCoordinator = app.crdtOperations?.syncCoordinator;
	if (!syncCoordinator) {
		throw new TypeError(
			"QUESTPIE CRDT host requires the app drain coordinator",
		);
	}
	const requestContexts = new WeakMap<Request, CRUDContext>();
	const admission = createCrdtTicketAdmissionStore(app.db, {
		secretKey: createHash("sha256")
			.update("questpie-crdt-ticket-key-v1\0")
			.update(secret)
			.digest("hex"),
	});
	const authorize = createCrdtTicketAuthorizationResolverV1({
		db: app.db,
		namespace: runtime.namespace,
		manifests: app.crdtManifests,
		engines: runtime.engines ?? {},
		loadOwnerRecord: async ({ owner, authentication, request }) => {
			await contextFor(app, requestContexts, request, authentication);
			return loadQuestpieCrdtOwnerRecord(app, owner);
		},
		authorizePolicy: async ({ owner, authentication, request, record }) => {
			const context = await contextFor(
				app,
				requestContexts,
				request,
				authentication,
			);
			return evaluateQuestpieCrdtOwnerPolicy(app, owner, record, context);
		},
	});

	return createCrdtHostApplicationV1({
		namespace: runtime.namespace,
		appUrl: app.config.app.url,
		audience: config.audience,
		allowedOrigins: runtime.allowedOrigins,
		admission,
		authenticateBrowser: async (request) => {
			if (config.authenticateBrowser) {
				return config.authenticateBrowser(request);
			}
			const adapter = await createAdapterContext(app, request, {
				accessMode: "user",
			});
			const principal = adapter.appContext.principal;
			if (
				!principal ||
				(principal.kind !== "user" && principal.kind !== "oauth")
			) {
				return null;
			}
			requestContexts.set(request, adapter.appContext as CRUDContext);
			return principal;
		},
		authenticateAgent: async (input) =>
			(await runtime.authenticateAgent?.(input)) ?? null,
		authorize,
		openAuthenticatedSession: (input) =>
			config.openAuthenticatedSession({
				...input,
				coordinator: syncCoordinator,
			}),
	});
}

async function contextFor(
	app: Questpie<any>,
	cache: WeakMap<Request, CRUDContext>,
	request: Request,
	authentication: CrdtAuthentication,
): Promise<CRUDContext> {
	const cached = cache.get(request);
	if (cached) return cached;
	if (authentication.actor.kind === "human") {
		const principal = authentication.principal;
		if (!principal)
			throw new Error("CRDT Human context is missing a principal");
		const context = await app.createContext({
			principal,
			session:
				principal.kind === "user"
					? { user: principal.user, session: principal.session }
					: null,
			actor: authentication.actor,
			accessMode: "user",
			request,
		});
		cache.set(request, context as CRUDContext);
		return context as CRUDContext;
	}
	const context = await app.createContext({
		session: null,
		actor: authentication.actor,
		accessMode: "user",
		request,
	});
	cache.set(request, context as CRUDContext);
	return context as CRUDContext;
}

export async function loadQuestpieCrdtOwnerRecord(
	app: Questpie<any>,
	owner: CrdtResolvedOwnerV1,
	database: Questpie<any>["db"] = app.db,
): Promise<Record<string, unknown> | null> {
	const crud =
		owner.kind === "collection"
			? (app.collections as Record<string, any>)[owner.key]
			: (app.globals as Record<string, any>)[owner.key];
	const table = crud?.["~internalRelatedTable"];
	if (!table) return null;
	if (owner.kind === "global") {
		const [record] = await database.select().from(table).limit(1);
		return (record as Record<string, unknown> | undefined) ?? null;
	}
	const id = getTableColumns(table).id;
	if (!id) return null;
	const [record] = await database
		.select()
		.from(table)
		.where(eq(id, owner.id))
		.limit(1);
	return (record as Record<string, unknown> | undefined) ?? null;
}

export async function evaluateQuestpieCrdtOwnerPolicy(
	app: Questpie<any>,
	owner: CrdtResolvedOwnerV1,
	record: Record<string, unknown>,
	context: CRUDContext,
	database: Questpie<any>["db"] = app.db,
) {
	const crud =
		owner.kind === "collection"
			? (app.collections as Record<string, any>)[owner.key]
			: (app.globals as Record<string, any>)[owner.key];
	const state = crud?.["~internalState"] as
		| {
				access?: Record<string, any>;
				fieldDefinitions?: Record<string, unknown>;
		  }
		| undefined;
	if (!state) throw new Error("CRDT owner policy state is unavailable");
	const read = await ownerAccess(
		app,
		state,
		"read",
		context,
		record,
		undefined,
		owner.kind === "collection",
		database,
	);
	if (!read) {
		return { ownerRead: false, ownerEdit: false, fields: {} };
	}
	let edit = false;
	try {
		edit = await ownerAccess(
			app,
			state,
			"update",
			context,
			record,
			Object.freeze({}),
			owner.kind === "collection",
			database,
		);
	} catch {
		edit = false;
	}
	const fieldAccess = mergeFieldAccessRules(
		state.access?.fields,
		state.fieldDefinitions,
	);
	const restricted = new Set(
		await getRestrictedReadFields(structuredClone(record), context, {
			app,
			db: database,
			fieldAccess,
		}),
	);
	const fields: Record<string, { read: boolean; edit: boolean }> = {};
	for (const path of Object.keys(
		owner.kind === "collection"
			? (app.crdtRegistry.collections[owner.key]?.fields ?? {})
			: (app.crdtRegistry.globals[owner.key]?.fields ?? {}),
	)) {
		const readField = !restricted.has(path);
		const editField =
			readField &&
			edit &&
			(await checkFieldWriteAccess(
				path,
				fieldAccess,
				context,
				{ app, db: database },
				"update",
				record,
			));
		fields[path] = { read: readField, edit: editField };
	}
	return { ownerRead: true, ownerEdit: edit, fields };
}

async function ownerAccess(
	app: Questpie<any>,
	state: { access?: Record<string, any> },
	operation: "read" | "update",
	context: CRUDContext,
	record: Record<string, unknown>,
	input: unknown,
	allowWhere: boolean,
	database: Questpie<any>["db"],
): Promise<boolean> {
	const rule = state.access?.[operation] ?? app.defaultAccess?.[operation];
	const result = await executeAccessRule(rule, {
		app,
		db: database,
		session: context.session,
		principal: context.principal,
		actor: context.actor,
		locale: context.locale,
		row: record,
		input,
		request: (context as CRUDContext & { request?: Request }).request,
		contextExtensions: context["~contextExtensions"],
	});
	if (result === true) return true;
	if (
		allowWhere &&
		result &&
		typeof result === "object" &&
		(await matchesAccessConditions(result as AccessWhere, record))
	) {
		return true;
	}
	return false;
}
