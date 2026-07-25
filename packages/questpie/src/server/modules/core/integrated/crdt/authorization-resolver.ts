import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { and, asc, eq, gt, isNull } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";
import {
	authoritySubject,
	type CrdtAuthentication,
} from "#questpie/server/modules/core/integrated/crdt/authority.js";
import {
	CrdtAuthorizationRejectedError,
	type CrdtAuthorizationInputV1,
	type CrdtAuthorizationSnapshot,
	type CrdtAuthorizedBindingCut,
	type CrdtAuthorizedGrant,
	type CrdtTargetV1,
} from "#questpie/server/modules/core/integrated/crdt/authorization.js";
import { createDeterministicSetEngine } from "#questpie/server/modules/core/integrated/crdt/deterministic-engine.js";
import type { CrdtDesiredManifest } from "#questpie/server/modules/core/integrated/crdt/manifest.js";
import { oauthCrdtScopesAllow } from "#questpie/server/modules/core/integrated/crdt/oauth-scope.js";
import {
	canonicalCrdtCollectionLocator,
	canonicalCrdtGlobalLocator,
} from "#questpie/server/modules/core/integrated/crdt/owner-lifecycle.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtDefinitionTable,
	questpieCrdtNamespaceTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSchemaTable,
	questpieCrdtSnapshotTable,
	questpieCrdtSubjectFenceTable,
	questpieCrdtSubjectTable,
	questpieCrdtUpdateTable,
} from "#questpie/server/modules/core/integrated/crdt/schema.js";
import type {
	CrdtEngineFormat,
	CrdtFieldEngine,
	CrdtEngineReplica,
} from "#questpie/shared/crdt-engine.js";

type CrdtDatabase = AnyDrizzleClient<any>;
type CrdtMode = "view" | "edit";
type AnyEngine = CrdtFieldEngine<CrdtEngineFormat, any>;
type AnyReplica = CrdtEngineReplica<CrdtEngineFormat, any>;

export type CrdtOwnerPolicyDecisionV1 = Readonly<{
	ownerRead: boolean;
	ownerEdit: boolean;
	fields: Readonly<Record<string, Readonly<{ read: boolean; edit: boolean }>>>;
}>;

export type CrdtAuthorizationResolverConfigV1 = Readonly<{
	db: CrdtDatabase;
	namespace: string;
	manifests: Readonly<{
		collections: Readonly<Record<string, CrdtDesiredManifest>>;
		globals: Readonly<Record<string, CrdtDesiredManifest>>;
	}>;
	engines: Readonly<{ text?: CrdtFieldEngine<"text", string> }>;
	loadOwnerRecord(
		input: Readonly<{
			owner: CrdtResolvedOwnerV1;
			authentication: CrdtAuthentication;
			request: Request;
		}>,
	): Promise<Record<string, unknown> | null>;
	authorizePolicy(
		input: Readonly<{
			owner: CrdtResolvedOwnerV1;
			authentication: CrdtAuthentication;
			request: Request;
			record: Record<string, unknown>;
		}>,
	): Promise<CrdtOwnerPolicyDecisionV1>;
	isAwarenessEnabled?(owner: CrdtResolvedOwnerV1): boolean;
	now?: () => Date;
}>;

export type CrdtResolvedOwnerV1 =
	| Readonly<{
			kind: "collection";
			key: string;
			ownerKey: string;
			id: string | number;
			locator: string;
	  }>
	| Readonly<{
			kind: "global";
			key: string;
			ownerKey: string;
			locator: string;
	  }>;

type ResolvedResource = Readonly<{
	id: string;
	incarnationKey: string;
	definitionId: string;
	resourceEpochId: string;
	schemaId: string;
	headCommitSeq: bigint;
	resourceReadFence: bigint;
	resourceEditFence: bigint;
	ownerPolicyRevision: bigint;
	sessionGeneration: bigint;
	owner: CrdtResolvedOwnerV1;
	manifest: CrdtDesiredManifest;
	bindings: readonly BindingRow[];
}>;

type BindingRow = Readonly<{
	bindingId: string;
	stableFieldId: string;
	fieldEpoch: bigint;
	fieldSlot: number;
	format: number;
	formatVersion: number;
	sourcePath: string;
	headFieldCursor: bigint;
	fieldReadFence: bigint;
	fieldEditFence: bigint;
	canonicalHash: Uint8Array;
}>;

export function createCrdtAuthorizationResolverV1(
	config: CrdtAuthorizationResolverConfigV1,
): (input: CrdtAuthorizationInputV1) => Promise<CrdtAuthorizationSnapshot> {
	if (
		typeof config.namespace !== "string" ||
		config.namespace.length === 0 ||
		config.namespace.length > 64
	) {
		throw new TypeError("CRDT authorization namespace is invalid");
	}
	const setEngine = createDeterministicSetEngine();

	return async (input) => {
		try {
			const now = config.now?.() ?? new Date();
			assertTime(now);
			await assertNamespace(config.db, config.namespace);
			const resource =
				input.purpose === "issue"
					? await resolveIssueResource(config, input.target)
					: await resolveExchangeResource(config, input.resourceId);
			const requestedMode =
				input.purpose === "issue" ? input.target.mode : input.requestedMode;
			const principal = input.authentication.principal;
			if (
				principal?.kind === "oauth" &&
				!oauthCrdtScopesAllow(principal, resource.owner, requestedMode)
			) {
				throw rejected();
			}
			const subject = await resolveSubject(config.db, input.authentication);
			const canonicalValues = await materializeCanonicalValues(
				config.db,
				resource,
				config.engines.text,
				setEngine,
			);
			const ownerRecord = await config.loadOwnerRecord({
				owner: resource.owner,
				authentication: input.authentication,
				request: input.request,
			});
			if (!ownerRecord) throw rejected();
			const record = overlayCanonicalValues(ownerRecord, canonicalValues);
			const decision = await config.authorizePolicy({
				owner: resource.owner,
				authentication: input.authentication,
				request: input.request,
				record,
			});
			const expectedEffectiveMode =
				input.purpose === "issue" ? undefined : input.effectiveMode;
			const fieldFences = await readSubjectFences(
				config.db,
				resource.id,
				subject.id,
			);
			const bindings = resource.bindings.map(bindingCut);
			const grants = authorizedGrants(
				resource.bindings,
				decision,
				fieldFences,
				requestedMode,
			);
			if (!decision.ownerRead || grants.length === 0) throw rejected();
			const effectiveMode = resolveEffectiveMode({
				requestedMode,
				grants,
				allowFallback:
					input.purpose === "issue"
						? input.target.fallback === "view"
						: expectedEffectiveMode === "view",
			});
			if (
				expectedEffectiveMode !== undefined &&
				effectiveMode !== expectedEffectiveMode
			) {
				throw rejected();
			}
			const authorityExpiresAt = authorityExpiry(input.authentication, now);
			const offlineSubjectKey = createHash("sha256")
				.update("questpie-crdt-offline-subject-v1\0")
				.update(config.namespace)
				.update("\0")
				.update(subject.id)
				.digest("base64url");
			const manifestFieldsByStableId = new Map(
				resource.manifest.fields.map((field) => [field.stableFieldId, field]),
			);
			const clientFields = Object.fromEntries(
				grants.map((grant) => {
					const field = manifestFieldsByStableId.get(grant.stableFieldId);
					if (!field) throw rejected();
					return [
						field.sourcePath,
						Object.freeze({
							fieldSlot: field.fieldSlot,
							format: field.format,
							formatVersion: field.formatVersion,
							engineId: field.engineId,
							grant: grant.grant,
						}),
					];
				}),
			);
			return Object.freeze({
				resourceId: resource.id,
				resourceEpochId: resource.resourceEpochId,
				definitionId: resource.definitionId,
				schemaId: resource.schemaId,
				incarnationKey: resource.incarnationKey,
				subjectId: subject.id,
				credentialFingerprint: credentialFingerprint(input.authentication),
				audience: input.audience,
				origin: input.origin,
				requestedMode,
				effectiveMode,
				resourceReadFence: resource.resourceReadFence,
				resourceEditFence: resource.resourceEditFence,
				ownerPolicyRevision: resource.ownerPolicyRevision,
				subjectReadFence: fieldFences.aggregate.read,
				subjectEditFence: fieldFences.aggregate.edit,
				sessionGeneration: resource.sessionGeneration,
				authorityExpiresAt,
				headCommitSeq: resource.headCommitSeq,
				offlineSubjectKey,
				clientManifest: Object.freeze({
					schemaVersion: resource.manifest.version,
					schemaFingerprint: Buffer.from(
						resource.manifest.fingerprint,
					).toString("base64url"),
					awarenessEnabled:
						config.isAwarenessEnabled?.(resource.owner) ?? false,
					fields: Object.freeze(clientFields),
				}),
				bindings: Object.freeze(bindings),
				grants: Object.freeze(grants),
			});
		} catch (error) {
			if (error instanceof TypeError) throw error;
			throw rejected();
		}
	};
}

async function resolveIssueResource(
	config: CrdtAuthorizationResolverConfigV1,
	target: CrdtTargetV1,
): Promise<ResolvedResource> {
	if (target.namespace !== config.namespace) throw rejected();
	const manifests =
		target.owner.kind === "collection"
			? config.manifests.collections
			: config.manifests.globals;
	const manifest = manifests[target.owner.key];
	if (!manifest) throw rejected();
	const expectedKind = target.owner.kind === "collection" ? 1 : 2;
	if (manifest.owner.kind !== expectedKind) throw rejected();
	const locator =
		target.owner.kind === "collection"
			? canonicalCrdtCollectionLocator(target.owner.id)
			: canonicalCrdtGlobalLocator();
	const locatorHash = Buffer.from(sha256(Buffer.from(locator, "utf8")));
	const [resource] = await config.db
		.select({ id: questpieCrdtResourceTable.id })
		.from(questpieCrdtResourceTable)
		.innerJoin(
			questpieCrdtDefinitionTable,
			eq(
				questpieCrdtDefinitionTable.id,
				questpieCrdtResourceTable.definitionId,
			),
		)
		.where(
			and(
				eq(questpieCrdtDefinitionTable.ownerKind, expectedKind),
				eq(questpieCrdtDefinitionTable.ownerKey, manifest.owner.key),
				eq(questpieCrdtResourceTable.locatorHash, locatorHash),
				eq(questpieCrdtResourceTable.locator, locator),
				eq(questpieCrdtResourceTable.status, 1),
				isNull(questpieCrdtResourceTable.retiredAt),
			),
		);
	if (!resource) throw rejected();
	return loadResource(config, resource.id, target.owner.key, manifest);
}

async function resolveExchangeResource(
	config: CrdtAuthorizationResolverConfigV1,
	resourceId: string,
): Promise<ResolvedResource> {
	const [identity] = await config.db
		.select({
			ownerKind: questpieCrdtDefinitionTable.ownerKind,
			ownerKey: questpieCrdtDefinitionTable.ownerKey,
		})
		.from(questpieCrdtResourceTable)
		.innerJoin(
			questpieCrdtDefinitionTable,
			eq(
				questpieCrdtDefinitionTable.id,
				questpieCrdtResourceTable.definitionId,
			),
		)
		.where(
			and(
				eq(questpieCrdtResourceTable.id, resourceId),
				eq(questpieCrdtResourceTable.status, 1),
				isNull(questpieCrdtResourceTable.retiredAt),
			),
		);
	if (!identity || (identity.ownerKind !== 1 && identity.ownerKind !== 2)) {
		throw rejected();
	}
	const entries = Object.entries(
		identity.ownerKind === 1
			? config.manifests.collections
			: config.manifests.globals,
	);
	const match = entries.find(
		([, manifest]) => manifest.owner.key === identity.ownerKey,
	);
	if (!match) throw rejected();
	return loadResource(config, resourceId, match[0], match[1]);
}

async function loadResource(
	config: CrdtAuthorizationResolverConfigV1,
	resourceId: string,
	registryKey: string,
	manifest: CrdtDesiredManifest,
): Promise<ResolvedResource> {
	const [row] = await config.db
		.select({
			id: questpieCrdtResourceTable.id,
			incarnationKey: questpieCrdtResourceTable.incarnationKey,
			definitionId: questpieCrdtResourceTable.definitionId,
			resourceEpochId: questpieCrdtResourceTable.currentEpochId,
			locator: questpieCrdtResourceTable.locator,
			resourceReadFence: questpieCrdtResourceTable.readFence,
			resourceEditFence: questpieCrdtResourceTable.editFence,
			ownerPolicyRevision: questpieCrdtResourceTable.ownerPolicyRevision,
			sessionGeneration: questpieCrdtResourceTable.sessionGeneration,
			ownerKind: questpieCrdtDefinitionTable.ownerKind,
			ownerKey: questpieCrdtDefinitionTable.ownerKey,
			identityVersion: questpieCrdtDefinitionTable.identityVersion,
		})
		.from(questpieCrdtResourceTable)
		.innerJoin(
			questpieCrdtDefinitionTable,
			eq(
				questpieCrdtDefinitionTable.id,
				questpieCrdtResourceTable.definitionId,
			),
		)
		.where(
			and(
				eq(questpieCrdtResourceTable.id, resourceId),
				eq(questpieCrdtResourceTable.status, 1),
				isNull(questpieCrdtResourceTable.retiredAt),
			),
		);
	if (
		!row?.resourceEpochId ||
		row.ownerKind !== manifest.owner.kind ||
		row.ownerKey !== manifest.owner.key ||
		row.identityVersion !== manifest.owner.identityVersion
	) {
		throw rejected();
	}
	const [epoch] = await config.db
		.select({
			schemaId: questpieCrdtResourceEpochTable.schemaId,
			headCommitSeq: questpieCrdtResourceEpochTable.headCommitSeq,
		})
		.from(questpieCrdtResourceEpochTable)
		.where(
			and(
				eq(questpieCrdtResourceEpochTable.id, row.resourceEpochId),
				eq(questpieCrdtResourceEpochTable.resourceId, row.id),
				eq(questpieCrdtResourceEpochTable.status, 1),
			),
		);
	if (!epoch) throw rejected();
	const [schema] = await config.db
		.select({
			version: questpieCrdtSchemaTable.schemaVersion,
			fingerprint: questpieCrdtSchemaTable.schemaFingerprint,
		})
		.from(questpieCrdtSchemaTable)
		.where(
			and(
				eq(questpieCrdtSchemaTable.id, epoch.schemaId),
				eq(questpieCrdtSchemaTable.definitionId, row.definitionId),
			),
		);
	if (
		!schema ||
		schema.version !== BigInt(manifest.version) ||
		!equalBytes(schema.fingerprint, manifest.fingerprint)
	) {
		throw rejected();
	}
	const storedBindings = await config.db
		.select({
			bindingId: questpieCrdtBindingTable.id,
			stableFieldId: questpieCrdtBindingTable.stableFieldId,
			fieldEpoch: questpieCrdtBindingTable.fieldEpoch,
			fieldSlot: questpieCrdtBindingTable.fieldSlot,
			format: questpieCrdtBindingTable.format,
			formatVersion: questpieCrdtBindingTable.formatVersion,
			sourcePath: questpieCrdtBindingTable.sourcePath,
			headFieldCursor: questpieCrdtBindingTable.headFieldCursor,
			fieldReadFence: questpieCrdtBindingTable.readFence,
			fieldEditFence: questpieCrdtBindingTable.editFence,
			canonicalHash: questpieCrdtBindingTable.canonicalHash,
			status: questpieCrdtBindingTable.status,
		})
		.from(questpieCrdtBindingTable)
		.where(
			and(
				eq(questpieCrdtBindingTable.resourceId, row.id),
				eq(questpieCrdtBindingTable.schemaId, epoch.schemaId),
				isNull(questpieCrdtBindingTable.retiredAt),
			),
		)
		.orderBy(asc(questpieCrdtBindingTable.stableFieldId));
	if (
		storedBindings.length === 0 ||
		storedBindings.some((binding) => binding.status !== 1) ||
		!bindingsMatchManifest(storedBindings, manifest)
	) {
		throw rejected();
	}
	const owner =
		manifest.owner.kind === 1
			? collectionOwner(registryKey, manifest.owner.key, row.locator)
			: globalOwner(registryKey, manifest.owner.key, row.locator);
	return Object.freeze({
		id: row.id,
		incarnationKey: row.incarnationKey,
		definitionId: row.definitionId,
		resourceEpochId: row.resourceEpochId,
		schemaId: epoch.schemaId,
		headCommitSeq: epoch.headCommitSeq,
		resourceReadFence: row.resourceReadFence,
		resourceEditFence: row.resourceEditFence,
		ownerPolicyRevision: row.ownerPolicyRevision,
		sessionGeneration: row.sessionGeneration,
		owner,
		manifest,
		bindings: Object.freeze(
			storedBindings.map(({ status: _status, ...binding }) =>
				Object.freeze(binding),
			),
		),
	});
}

async function materializeCanonicalValues(
	db: CrdtDatabase,
	resource: ResolvedResource,
	textEngine: CrdtFieldEngine<"text", string> | undefined,
	setEngine: CrdtFieldEngine<"set", readonly string[]>,
): Promise<Record<string, unknown>> {
	const [epoch] = await db
		.select({
			manifestId: questpieCrdtResourceEpochTable.currentSnapshotManifestId,
		})
		.from(questpieCrdtResourceEpochTable)
		.where(eq(questpieCrdtResourceEpochTable.id, resource.resourceEpochId));
	if (!epoch?.manifestId) throw rejected();
	const snapshots = await db
		.select()
		.from(questpieCrdtSnapshotTable)
		.where(eq(questpieCrdtSnapshotTable.manifestId, epoch.manifestId))
		.orderBy(asc(questpieCrdtSnapshotTable.stableFieldId));
	if (snapshots.length !== resource.bindings.length) throw rejected();
	const updates = await db
		.select()
		.from(questpieCrdtUpdateTable)
		.where(
			and(
				eq(questpieCrdtUpdateTable.resourceId, resource.id),
				eq(questpieCrdtUpdateTable.resourceEpochId, resource.resourceEpochId),
				gt(questpieCrdtUpdateTable.commitSeq, 0n),
			),
		)
		.orderBy(
			asc(questpieCrdtUpdateTable.commitSeq),
			asc(questpieCrdtUpdateTable.fieldSlot),
		);
	const byBinding = new Map<string, typeof updates>();
	for (const update of updates) {
		const list = byBinding.get(update.bindingId) ?? [];
		list.push(update);
		byBinding.set(update.bindingId, list);
	}

	const values: Record<string, unknown> = {};
	for (const binding of resource.bindings) {
		const snapshot = snapshots.find(
			(candidate) => candidate.bindingId === binding.bindingId,
		);
		if (
			!snapshot ||
			snapshot.stableFieldId !== binding.stableFieldId ||
			snapshot.fieldEpoch !== binding.fieldEpoch ||
			snapshot.fieldSlot !== binding.fieldSlot ||
			snapshot.formatVersion !== binding.formatVersion ||
			!equalBytes(sha256(snapshot.bytes), snapshot.checksum)
		) {
			throw rejected();
		}
		const engine = binding.format === 1 ? textEngine : setEngine;
		if (
			!engine ||
			engine.engineId !== snapshot.engineId ||
			engine.engineVersion !== snapshot.engineVersion ||
			engine.stateVersion !== snapshot.stateVersion ||
			engine.formatVersion !== binding.formatVersion
		) {
			throw rejected();
		}
		let replica: AnyReplica = await (engine as AnyEngine).restore({
			snapshot: new Uint8Array(snapshot.bytes),
			basis: {
				fieldEpoch: binding.fieldEpoch,
				fieldCursor: snapshot.fieldCursor,
			},
		});
		for (const update of (byBinding.get(binding.bindingId) ?? []).filter(
			(candidate) => candidate.fieldCursor > snapshot.fieldCursor,
		)) {
			if (
				update.fieldEpoch !== binding.fieldEpoch ||
				update.formatVersion !== binding.formatVersion ||
				update.baseFieldCursor !== replica.basis.fieldCursor ||
				update.fieldCursor > binding.headFieldCursor ||
				!equalBytes(sha256(update.bytes), update.checksum)
			) {
				throw rejected();
			}
			const candidate = await (engine as AnyEngine).stage({
				replica,
				update: new Uint8Array(update.bytes),
			});
			replica = await (engine as AnyEngine).commit({
				candidate,
				current: replica,
				assignedFieldCursor: update.fieldCursor,
			});
		}
		const projection = (engine as AnyEngine).project(replica);
		if (
			replica.basis.fieldCursor !== binding.headFieldCursor ||
			!equalBytes(
				hashCanonicalValue(binding.format === 1 ? "text" : "set", projection),
				binding.canonicalHash,
			)
		) {
			throw rejected();
		}
		setPath(values, binding.sourcePath, projection);
	}
	return values;
}

async function resolveSubject(
	db: CrdtDatabase,
	authentication: CrdtAuthentication,
): Promise<{ id: string }> {
	const subject = authoritySubject(authentication);
	const kind = subject.kind === "human" ? 1 : 2;
	const issuerKey = subject.kind === "agent" ? subject.issuer : "";
	const subjectKey = subject.subjectId;
	const subjectHash = Buffer.from(
		sha256(
			Buffer.from(
				`questpie-crdt-subject-v1\0${kind}\0${issuerKey}\0${subjectKey}`,
				"utf8",
			),
		),
	);
	await db
		.insert(questpieCrdtSubjectTable)
		.values({ kind, issuerKey, subjectKey, subjectHash })
		.onConflictDoNothing();
	const [stored] = await db
		.select({
			id: questpieCrdtSubjectTable.id,
			subjectHash: questpieCrdtSubjectTable.subjectHash,
		})
		.from(questpieCrdtSubjectTable)
		.where(
			and(
				eq(questpieCrdtSubjectTable.kind, kind),
				eq(questpieCrdtSubjectTable.issuerKey, issuerKey),
				eq(questpieCrdtSubjectTable.subjectKey, subjectKey),
			),
		);
	if (!stored || !equalBytes(stored.subjectHash, subjectHash)) throw rejected();
	return { id: stored.id };
}

async function readSubjectFences(
	db: CrdtDatabase,
	resourceId: string,
	subjectId: string,
): Promise<{
	aggregate: { read: bigint; edit: bigint };
	fields: ReadonlyMap<string, { read: bigint; edit: bigint }>;
}> {
	const rows = await db
		.select()
		.from(questpieCrdtSubjectFenceTable)
		.where(
			and(
				eq(questpieCrdtSubjectFenceTable.resourceId, resourceId),
				eq(questpieCrdtSubjectFenceTable.subjectId, subjectId),
			),
		);
	const aggregate = rows.find((row) => row.scopeKind === 1);
	return {
		aggregate: {
			read: aggregate?.readFence ?? 0n,
			edit: aggregate?.editFence ?? 0n,
		},
		fields: new Map(
			rows
				.filter((row) => row.scopeKind === 2)
				.map((row) => [
					row.stableFieldId,
					{ read: row.readFence, edit: row.editFence },
				]),
		),
	};
}

function authorizedGrants(
	bindings: readonly BindingRow[],
	decision: CrdtOwnerPolicyDecisionV1,
	fences: Awaited<ReturnType<typeof readSubjectFences>>,
	requestedMode: CrdtMode,
): CrdtAuthorizedGrant[] {
	const grants: CrdtAuthorizedGrant[] = [];
	for (const binding of bindings) {
		const policy = decision.fields[binding.sourcePath];
		if (policy?.read !== true) continue;
		const subjectFence = fences.fields.get(binding.stableFieldId);
		grants.push(
			Object.freeze({
				...bindingCut(binding),
				grant:
					requestedMode === "edit" &&
					decision.ownerEdit === true &&
					policy.edit === true
						? "edit"
						: "view",
				subjectFieldReadFence: subjectFence?.read ?? 0n,
				subjectFieldEditFence: subjectFence?.edit ?? 0n,
			}),
		);
	}
	return grants;
}

function bindingCut(binding: BindingRow): CrdtAuthorizedBindingCut {
	return Object.freeze({
		bindingId: binding.bindingId,
		stableFieldId: binding.stableFieldId,
		fieldEpoch: binding.fieldEpoch,
		fieldSlot: binding.fieldSlot,
		formatVersion: binding.formatVersion,
		headFieldCursor: binding.headFieldCursor,
		fieldReadFence: binding.fieldReadFence,
		fieldEditFence: binding.fieldEditFence,
	});
}

function resolveEffectiveMode(input: {
	requestedMode: CrdtMode;
	grants: readonly CrdtAuthorizedGrant[];
	allowFallback: boolean;
}): CrdtMode {
	if (input.requestedMode === "view") return "view";
	if (input.grants.some((grant) => grant.grant === "edit")) return "edit";
	if (input.allowFallback) return "view";
	throw rejected();
}

async function assertNamespace(
	db: CrdtDatabase,
	namespace: string,
): Promise<void> {
	const [stored] = await db
		.select({ namespace: questpieCrdtNamespaceTable.namespace })
		.from(questpieCrdtNamespaceTable)
		.where(eq(questpieCrdtNamespaceTable.singleton, 1));
	if (stored?.namespace !== namespace) throw rejected();
}

function bindingsMatchManifest(
	bindings: ReadonlyArray<{
		stableFieldId: string;
		fieldSlot: number;
		sourcePath: string;
		format: number;
		formatVersion: number;
	}>,
	manifest: CrdtDesiredManifest,
): boolean {
	if (bindings.length !== manifest.fields.length) return false;
	return manifest.fields.every((field) => {
		const binding = bindings.find(
			(candidate) => candidate.stableFieldId === field.stableFieldId,
		);
		return (
			binding !== undefined &&
			binding.fieldSlot === field.fieldSlot &&
			binding.sourcePath === field.sourcePath &&
			binding.format === (field.format === "text" ? 1 : 2) &&
			binding.formatVersion === field.formatVersion
		);
	});
}

function authorityExpiry(authentication: CrdtAuthentication, now: Date): Date {
	const maximum = now.getTime() + 90_000;
	let credentialExpiry = maximum;
	if (authentication.actor.kind === "agent") {
		credentialExpiry = authentication.actor.expiresAt.getTime();
	} else {
		const principal = authentication.principal;
		if (!principal) throw rejected();
		if (principal.kind !== "user") {
			return new Date(maximum);
		}
		const value = (principal.session as { expiresAt?: unknown }).expiresAt;
		const parsed =
			value instanceof Date
				? value
				: typeof value === "string" || typeof value === "number"
					? new Date(value)
					: null;
		if (!parsed || !Number.isFinite(parsed.getTime())) throw rejected();
		credentialExpiry = parsed.getTime();
	}
	const expiresAt = new Date(Math.min(maximum, credentialExpiry));
	if (expiresAt <= now) throw rejected();
	return expiresAt;
}

function credentialFingerprint(authentication: CrdtAuthentication): Uint8Array {
	let identity: string;
	if (authentication.actor.kind === "agent") {
		identity = `agent\0${authentication.actor.issuer}\0${authentication.actor.credentialId}`;
	} else {
		const principal = authentication.principal;
		if (!principal) throw rejected();
		if (principal.kind === "oauth") {
			identity = `oauth\0${principal.clientId}\0${principal.tokenId}`;
		} else {
			const sessionId = (principal.session as { id?: unknown }).id;
			if (typeof sessionId !== "string" || sessionId.length === 0) {
				throw rejected();
			}
			identity = `human\0${sessionId}`;
		}
	}
	return sha256(
		Buffer.from(`questpie-crdt-credential-v1\0${identity}`, "utf8"),
	);
}

function collectionOwner(
	key: string,
	ownerKey: string,
	locator: string,
): Extract<CrdtResolvedOwnerV1, { kind: "collection" }> {
	let value: unknown;
	try {
		value = JSON.parse(locator);
	} catch {
		throw rejected();
	}
	if (
		!Array.isArray(value) ||
		value.length !== 3 ||
		value[0] !== "id" ||
		(value[1] !== "string" && value[1] !== "number") ||
		(value[1] === "string" && typeof value[2] !== "string") ||
		(value[1] === "number" &&
			(typeof value[2] !== "number" || !Number.isSafeInteger(value[2]))) ||
		canonicalCrdtCollectionLocator(value[2] as string | number) !== locator
	) {
		throw rejected();
	}
	return Object.freeze({
		kind: "collection",
		key,
		ownerKey,
		id: value[2] as string | number,
		locator,
	});
}

function globalOwner(
	key: string,
	ownerKey: string,
	locator: string,
): Extract<CrdtResolvedOwnerV1, { kind: "global" }> {
	if (locator !== canonicalCrdtGlobalLocator()) throw rejected();
	return Object.freeze({ kind: "global", key, ownerKey, locator });
}

function overlayCanonicalValues(
	record: Record<string, unknown>,
	values: Record<string, unknown>,
): Record<string, unknown> {
	const result = structuredClone(record);
	for (const [path, value] of Object.entries(values)) {
		setPath(result, path, structuredClone(value));
	}
	return result;
}

function setPath(
	target: Record<string, unknown>,
	path: string,
	value: unknown,
): void {
	const parts = path.split(".");
	if (
		parts.length === 0 ||
		parts.some(
			(part) =>
				part.length === 0 ||
				part === "__proto__" ||
				part === "prototype" ||
				part === "constructor",
		)
	) {
		throw rejected();
	}
	let current = target;
	for (const part of parts.slice(0, -1)) {
		const next = current[part];
		if (!next || typeof next !== "object" || Array.isArray(next)) {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}
	current[parts.at(-1)!] = value;
}

function assertTime(value: Date): void {
	if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
		throw new TypeError("CRDT authorization clock is invalid");
	}
}

function sha256(value: Uint8Array): Uint8Array {
	return createHash("sha256").update(value).digest();
}

function hashCanonicalValue(
	format: CrdtEngineFormat,
	value: unknown,
): Uint8Array {
	const hash = createHash("sha256");
	hash.update("questpie-crdt-canonical-value-v1\0");
	hash.update(format);
	hash.update("\0");
	if (format === "text") {
		if (typeof value !== "string") throw rejected();
		hash.update(value, "utf8");
	} else {
		if (
			!Array.isArray(value) ||
			value.some((entry) => typeof entry !== "string")
		) {
			throw rejected();
		}
		writeU32(hash, value.length);
		for (const entry of value) {
			const bytes = Buffer.from(entry, "utf8");
			writeU32(hash, bytes.byteLength);
			hash.update(bytes);
		}
	}
	return hash.digest();
}

function writeU32(hash: ReturnType<typeof createHash>, value: number): void {
	const bytes = Buffer.allocUnsafe(4);
	bytes.writeUInt32BE(value);
	hash.update(bytes);
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return Buffer.from(left).equals(Buffer.from(right));
}

function rejected(): CrdtAuthorizationRejectedError {
	return new CrdtAuthorizationRejectedError();
}
