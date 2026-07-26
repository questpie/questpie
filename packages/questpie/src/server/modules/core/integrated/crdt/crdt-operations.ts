import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import {
	getCurrentTransaction,
	withTransaction,
} from "#questpie/server/collection/crud/shared/transaction.js";
import type { AnyDrizzleClient } from "#questpie/server/config/types.js";
import {
	createCrdtTextAnchorToken,
	resolveCrdtTextAnchorToken,
	type CrdtTextAnchorBinding,
	type CrdtTextAnchorInput,
} from "#questpie/shared/crdt-anchor.js";
import type {
	CrdtEngineFormat,
	CrdtFieldEngine,
} from "#questpie/shared/crdt-engine.js";

import { loadCrdtAuthoritativeReplica } from "./append-store.js";
import {
	canonicalCrdtCollectionLocator,
	canonicalCrdtGlobalLocator,
} from "./owner-lifecycle.js";
import type { CrdtReplaceCommitAuthorization } from "./replace-store.js";
import type {
	CrdtAggregateReplaceInput,
	CrdtFieldReplaceInput,
} from "./replace.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtDefinitionTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSessionTable,
	questpieCrdtSubjectFenceTable,
	questpieCrdtSubjectTable,
} from "./schema.js";
import type {
	CrdtAuthoritySubject,
	CrdtServerAPI,
	CrdtServerDocumentStatus,
	CrdtServerFieldStatus,
} from "./types.js";

type CrdtDatabase = AnyDrizzleClient<any>;
type AnyEngine = CrdtFieldEngine<CrdtEngineFormat, any>;
type ReplaceStore = Readonly<{
	replaceField(
		input: CrdtFieldReplaceInput,
		authorization: CrdtReplaceCommitAuthorization,
	): Promise<unknown>;
	replaceAggregate(
		input: CrdtAggregateReplaceInput,
		authorization: CrdtReplaceCommitAuthorization,
	): Promise<unknown>;
}>;
type OwnerKind = "collection" | "global";
type OwnerDefinition = Readonly<{
	kind: OwnerKind;
	registryKey: string;
	ownerKey: string;
	locator: string;
}>;
type AuthorityDecision = Readonly<{
	ownerRead: boolean;
	ownerEdit: boolean;
	fields: Readonly<Record<string, Readonly<{ read: boolean; edit: boolean }>>>;
}>;
type AuthorityTargetState = Readonly<{
	service: object;
	owner: OwnerDefinition;
	fieldPath?: string;
	subject: CrdtAuthoritySubject;
	capability: "read" | "edit";
}>;
export type CrdtAuthorityFencePlan = Readonly<{
	resourceId: string;
	subjectId: string;
	scopeKind: 1 | 2;
	stableFieldId: string;
	capability: "read" | "edit";
}>;

const ZERO_UUID = "00000000-0000-0000-0000-000000000000";
const authorityTargets = new WeakMap<object, AuthorityTargetState>();

export type CrdtServerOperationsConfig = Readonly<{
	db: CrdtDatabase;
	namespace?: string;
	resolveEngine?(binding: { format: number; formatVersion: number }): AnyEngine;
	replace: ReplaceStore;
	owners: Readonly<{
		collections: Readonly<
			Record<
				string,
				Readonly<{
					ownerName: string;
					fields: Record<string, Readonly<{ format?: "text" | "set" }>>;
				}>
			>
		>;
		globals: Readonly<
			Record<
				string,
				Readonly<{
					ownerName: string;
					fields: Record<string, Readonly<{ format?: "text" | "set" }>>;
				}>
			>
		>;
	}>;
	authorize(
		owner: OwnerDefinition,
		database?: CrdtDatabase,
	): Promise<AuthorityDecision>;
}>;

export function createCrdtServerOperations(
	config: CrdtServerOperationsConfig,
): CrdtServerAPI<any> {
	const serviceIdentity = {};
	let authorityMutation:
		| {
				tx: unknown;
				targets: ReadonlyMap<object, AuthorityTargetState>;
		  }
		| undefined;

	const ownerApi = (kind: OwnerKind) =>
		Object.fromEntries(
			Object.entries(
				kind === "collection"
					? config.owners.collections
					: config.owners.globals,
			).map(([registryKey, registration]) => [
				registryKey,
				Object.freeze({
					document:
						kind === "collection"
							? (locator: { id: string | number }) =>
									document({
										kind,
										registryKey,
										ownerKey: registration.ownerName,
										locator: canonicalCrdtCollectionLocator(locator.id),
									})
							: () =>
									document({
										kind,
										registryKey,
										ownerKey: registration.ownerName,
										locator: canonicalCrdtGlobalLocator(),
									}),
				}),
			]),
		);

	const resolveResource = async (
		owner: OwnerDefinition,
		database: CrdtDatabase = config.db,
	) => {
		const [resource] = await database
			.select({
				id: questpieCrdtResourceTable.id,
				incarnationKey: questpieCrdtResourceTable.incarnationKey,
				status: questpieCrdtResourceTable.status,
				currentEpochId: questpieCrdtResourceTable.currentEpochId,
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
					eq(
						questpieCrdtDefinitionTable.ownerKind,
						owner.kind === "collection" ? 1 : 2,
					),
					eq(questpieCrdtDefinitionTable.ownerKey, owner.ownerKey),
					eq(questpieCrdtResourceTable.locator, owner.locator),
					isNull(questpieCrdtResourceTable.retiredAt),
				),
			);
		if (!resource?.currentEpochId) {
			throw new Error("CRDT resource is unavailable");
		}
		return resource;
	};

	const assertAuthority = async (
		owner: OwnerDefinition,
		fieldPath: string | undefined,
		capability: "read" | "edit",
		database: CrdtDatabase = config.db,
	) => {
		const decision = await config.authorize(owner, database);
		const ownerAllowed =
			capability === "read" ? decision.ownerRead : decision.ownerEdit;
		const fieldAllowed =
			fieldPath === undefined ||
			decision.fields[fieldPath]?.[capability] === true;
		if (!ownerAllowed || !fieldAllowed) {
			throw new Error("CRDT authority denied");
		}
	};

	const readStatus = async (
		owner: OwnerDefinition,
		database: CrdtDatabase = config.db,
	): Promise<CrdtServerDocumentStatus<any>> => {
		await assertAuthority(owner, undefined, "read", database);
		const resource = await resolveResource(owner, database);
		const resourceEpochId = resource.currentEpochId;
		if (!resourceEpochId) throw new Error("CRDT resource epoch is unavailable");
		const [epoch] = await database
			.select()
			.from(questpieCrdtResourceEpochTable)
			.where(eq(questpieCrdtResourceEpochTable.id, resourceEpochId));
		if (!epoch) throw new Error("CRDT resource epoch is unavailable");
		const bindings = await database
			.select()
			.from(questpieCrdtBindingTable)
			.where(
				and(
					eq(questpieCrdtBindingTable.resourceId, resource.id),
					isNull(questpieCrdtBindingTable.retiredAt),
				),
			);
		const decision = await config.authorize(owner, database);
		return {
			status: statusName(resource.status),
			aggregateEpoch: String(epoch.aggregateEpoch),
			headCommit: String(epoch.headCommitSeq),
			projectedCommit: String(epoch.projectedCommitSeq),
			fields: Object.fromEntries(
				bindings
					.filter((binding) => decision.fields[binding.sourcePath]?.read)
					.map((binding) => [binding.sourcePath, fieldStatus(binding)]),
			),
		};
	};

	const target = (
		owner: OwnerDefinition,
		fieldPath: string | undefined,
		input: {
			subject: CrdtAuthoritySubject;
			capability: "read" | "edit";
		},
	) => {
		if (input.capability !== "read" && input.capability !== "edit") {
			throw new TypeError("CRDT authority capability is invalid");
		}
		const result = Object.freeze({});
		authorityTargets.set(result, {
			service: serviceIdentity,
			owner,
			fieldPath,
			subject: snapshotSubject(input.subject),
			capability: input.capability,
		});
		return result as never;
	};

	const revoke = async (
		owner: OwnerDefinition,
		fieldPath: string | undefined,
		input: {
			subject: CrdtAuthoritySubject;
			capability: "read" | "edit";
			tx: unknown;
		},
	) => {
		const active = authorityMutation;
		if (
			!active ||
			active.tx !== input.tx ||
			getCurrentTransaction() !== input.tx
		) {
			throw new Error(
				"CRDT revoke requires the exact managed authority transaction",
			);
		}
		const expected = [...active.targets.values()].find(
			(entry) =>
				entry.owner.kind === owner.kind &&
				entry.owner.registryKey === owner.registryKey &&
				entry.owner.locator === owner.locator &&
				entry.fieldPath === fieldPath &&
				entry.capability === input.capability &&
				equalSubject(entry.subject, input.subject),
		);
		if (!expected) throw new Error("CRDT revoke target was not preauthorized");
		const tx = input.tx as CrdtDatabase;
		await assertAuthority(owner, fieldPath, input.capability, tx);
		return fieldPath === undefined
			? readStatus(owner, tx)
			: readFieldStatus(owner, fieldPath, tx);
	};

	const readFieldStatus = async (
		owner: OwnerDefinition,
		fieldPath: string,
		database: CrdtDatabase = config.db,
	): Promise<CrdtServerFieldStatus<any>> => {
		await assertAuthority(owner, fieldPath, "read", database);
		const resource = await resolveResource(owner, database);
		const [binding] = await database
			.select()
			.from(questpieCrdtBindingTable)
			.where(
				and(
					eq(questpieCrdtBindingTable.resourceId, resource.id),
					eq(questpieCrdtBindingTable.sourcePath, fieldPath),
					isNull(questpieCrdtBindingTable.retiredAt),
				),
			);
		if (!binding) throw new Error("CRDT field is unavailable");
		return fieldStatus(binding);
	};

	const loadTextAnchorField = async (
		owner: OwnerDefinition,
		fieldPath: string,
		database: CrdtDatabase,
	) => {
		await assertAuthority(owner, fieldPath, "read", database);
		if (!config.namespace || !config.resolveEngine) {
			throw new Error("CRDT text anchors are unavailable");
		}
		const resource = await resolveResource(owner, database);
		const [binding] = await database
			.select()
			.from(questpieCrdtBindingTable)
			.where(
				and(
					eq(questpieCrdtBindingTable.resourceId, resource.id),
					eq(questpieCrdtBindingTable.sourcePath, fieldPath),
					eq(questpieCrdtBindingTable.format, 1),
					isNull(questpieCrdtBindingTable.retiredAt),
				),
			);
		if (!binding) throw new Error("CRDT field is unavailable");
		if (binding.status !== 1 && binding.status !== 3) {
			throw new Error("CRDT field is unavailable");
		}
		const engine = config.resolveEngine(binding);
		if (
			engine.format !== "text" ||
			engine.formatVersion !== binding.formatVersion ||
			!engine.relativePositions
		) {
			throw new Error("CRDT text anchor engine is unavailable or incompatible");
		}
		const authoritative = await loadCrdtAuthoritativeReplica(database, {
			bindingId: binding.id,
			engine,
			bindingStatus: binding.status,
		});
		const replica = authoritative.replica;
		const anchorBinding: CrdtTextAnchorBinding = Object.freeze({
			namespace: config.namespace,
			incarnationKey: resource.incarnationKey,
			fieldSlot: binding.fieldSlot,
			fieldEpoch: binding.fieldEpoch,
			engineId: engine.engineId,
			formatVersion: engine.formatVersion,
		});
		return Object.freeze({
			binding: anchorBinding,
			engine,
			replica,
			value: engine.project(replica) as string,
			relativePositions: engine.relativePositions,
		});
	};

	function document(owner: OwnerDefinition): any {
		const registration =
			owner.kind === "collection"
				? config.owners.collections[owner.registryKey]
				: config.owners.globals[owner.registryKey];
		const fields = Object.fromEntries(
			Object.entries(registration?.fields ?? {}).map(
				([fieldPath, fieldDefinition]) => [
					fieldPath,
					Object.freeze({
						status: () => readFieldStatus(owner, fieldPath),
						...(fieldDefinition.format === "text"
							? {
									anchors: Object.freeze({
										async create(anchor: CrdtTextAnchorInput) {
											const database =
												(getCurrentTransaction() as CrdtDatabase | undefined) ??
												config.db;
											const field = await loadTextAnchorField(
												owner,
												fieldPath,
												database,
											);
											return createCrdtTextAnchorToken({
												...field,
												anchor,
											});
										},
										async resolve(token: string) {
											const database =
												(getCurrentTransaction() as CrdtDatabase | undefined) ??
												config.db;
											const field = await loadTextAnchorField(
												owner,
												fieldPath,
												database,
											);
											return resolveCrdtTextAnchorToken({
												...field,
												token,
											});
										},
									}),
								}
							: {}),
						async replace(input: any) {
							await assertAuthority(owner, fieldPath, "edit");
							const resource = await resolveResource(owner);
							const [binding] = await config.db
								.select({
									stableFieldId: questpieCrdtBindingTable.stableFieldId,
								})
								.from(questpieCrdtBindingTable)
								.where(
									and(
										eq(questpieCrdtBindingTable.resourceId, resource.id),
										eq(questpieCrdtBindingTable.sourcePath, fieldPath),
										isNull(questpieCrdtBindingTable.retiredAt),
									),
								);
							if (!binding) throw new Error("CRDT field is unavailable");
							await config.replace.replaceField(
								{
									resourceId: resource.id,
									stableFieldId: binding.stableFieldId,
									value: input.value,
									expected: {
										fieldEpoch: parseCounter(input.expected.fieldEpoch),
										canonicalRevision: parseCounter(
											input.expected.canonicalRevision,
										),
									},
									reason: input.reason,
								},
								{
									authorizeCommit: (transaction) =>
										assertAuthority(owner, fieldPath, "edit", transaction),
								},
							);
							return readFieldStatus(owner, fieldPath);
						},
						authorityTarget: (input: any) => target(owner, fieldPath, input),
						revoke: (input: any) => revoke(owner, fieldPath, input),
					}),
				],
			),
		);
		return Object.freeze({
			fields: Object.freeze(fields),
			status: () => readStatus(owner),
			async replace(input: any) {
				await assertAuthority(owner, undefined, "edit");
				for (const fieldPath of Object.keys(registration?.fields ?? {})) {
					await assertAuthority(owner, fieldPath, "edit");
				}
				const resource = await resolveResource(owner);
				await config.replace.replaceAggregate(
					{
						resourceId: resource.id,
						values: input.fields,
						expected: {
							aggregateEpoch: parseCounter(input.expected.aggregateEpoch),
							canonicalRevisions: Object.fromEntries(
								Object.entries(input.expected.canonicalRevisions).map(
									([key, value]) => [key, parseCounter(value)],
								),
							),
						},
						reason: input.reason,
					},
					{
						async authorizeCommit(transaction) {
							await assertAuthority(owner, undefined, "edit", transaction);
							for (const fieldPath of Object.keys(registration?.fields ?? {})) {
								await assertAuthority(owner, fieldPath, "edit", transaction);
							}
						},
					},
				);
				return readStatus(owner);
			},
			authorityTarget: (input: any) => target(owner, undefined, input),
			revoke: (input: any) => revoke(owner, undefined, input),
		});
	}

	const api: CrdtServerAPI<any> = {
		collections: Object.freeze(
			ownerApi("collection"),
		) as CrdtServerAPI<any>["collections"],
		globals: Object.freeze(ownerApi("global")) as CrdtServerAPI<any>["globals"],
		async withAuthorityMutation<TResult>(
			targets: readonly import("./types.js").CrdtAuthorityTarget[],
			mutation: (tx: unknown) => TResult | Promise<TResult>,
		) {
			if (authorityMutation) {
				throw new Error("Nested CRDT authority mutations are not supported");
			}
			const unique = new Set(targets as readonly object[]);
			if (unique.size !== targets.length) {
				throw new Error("CRDT authority targets must be unique");
			}
			for (const opaque of unique) {
				const state = authorityTargets.get(opaque);
				if (!state || state.service !== serviceIdentity) {
					throw new Error("CRDT authority target is invalid");
				}
				await assertAuthority(state.owner, state.fieldPath, state.capability);
			}
			return withTransaction(config.db, async (tx) => {
				const resolvedTargets = new Map(
					[...unique].map((opaque) => [opaque, authorityTargets.get(opaque)!]),
				);
				authorityMutation = { tx, targets: resolvedTargets };
				try {
					const result = await mutation(tx);
					await applyAuthorityTargets(tx as CrdtDatabase, resolvedTargets);
					return result;
				} finally {
					authorityMutation = undefined;
				}
			});
		},
	};
	return Object.freeze(api);

	async function applyAuthorityTargets(
		tx: CrdtDatabase,
		targets: ReadonlyMap<object, AuthorityTargetState>,
	): Promise<void> {
		const resolved = await Promise.all(
			[...targets.values()].map(async (state) => ({
				state,
				resource: await resolveResource(state.owner, tx),
			})),
		);
		resolved.sort((left, right) => {
			const resourceOrder = compareCanonicalStrings(
				left.resource.id,
				right.resource.id,
			);
			if (resourceOrder !== 0) return resourceOrder;
			return compareCanonicalStrings(
				authorityTargetSortKey(left.state),
				authorityTargetSortKey(right.state),
			);
		});
		const semanticKeys = new Set<string>();
		for (const entry of resolved) {
			const key = `${entry.resource.id}\0${authorityTargetSortKey(entry.state)}`;
			if (semanticKeys.has(key)) {
				throw new Error("CRDT authority targets must be semantically unique");
			}
			semanticKeys.add(key);
		}

		for (const resourceId of new Set(
			resolved.map((entry) => entry.resource.id),
		)) {
			const [locked] = await tx
				.select({ id: questpieCrdtResourceTable.id })
				.from(questpieCrdtResourceTable)
				.where(eq(questpieCrdtResourceTable.id, resourceId))
				.for("update");
			if (!locked) throw new Error("CRDT resource is unavailable");
			await tx
				.select({ id: questpieCrdtBindingTable.id })
				.from(questpieCrdtBindingTable)
				.where(
					and(
						eq(questpieCrdtBindingTable.resourceId, resourceId),
						isNull(questpieCrdtBindingTable.retiredAt),
					),
				)
				.orderBy(asc(questpieCrdtBindingTable.id))
				.for("update");
		}

		const unresolvedFences: Array<
			Omit<CrdtAuthorityFencePlan, "subjectId"> & {
				subjectKey: string;
			}
		> = [];
		const subjects = new Map<string, CrdtAuthoritySubject>();
		for (const { state, resource } of resolved) {
			await assertAuthority(state.owner, state.fieldPath, state.capability, tx);
			const stableFieldId =
				state.fieldPath === undefined
					? ZERO_UUID
					: await resolveStableFieldId(tx, resource.id, state.fieldPath);
			const subjectKey = canonicalCrdtAuthoritySubjectKey(state.subject);
			subjects.set(subjectKey, state.subject);
			unresolvedFences.push({
				resourceId: resource.id,
				stableFieldId,
				scopeKind: state.fieldPath === undefined ? 1 : 2,
				subjectKey,
				capability: state.capability,
			});
		}
		const subjectIds = new Map<string, string>();
		for (const subjectKey of [...subjects.keys()].sort()) {
			subjectIds.set(
				subjectKey,
				await resolveSubject(tx, subjects.get(subjectKey)!),
			);
		}
		const fences = orderCrdtAuthorityFencePlans(
			unresolvedFences.map(({ subjectKey, ...fence }) => ({
				...fence,
				subjectId: subjectIds.get(subjectKey)!,
			})),
		);
		for (const fence of fences) {
			await advanceAuthorityFence(tx, fence);
		}
	}
}

async function advanceAuthorityFence(
	tx: CrdtDatabase,
	input: CrdtAuthorityFencePlan,
): Promise<void> {
	const read = input.capability === "read";
	await tx
		.insert(questpieCrdtSubjectFenceTable)
		.values({
			resourceId: input.resourceId,
			subjectId: input.subjectId,
			scopeKind: input.scopeKind,
			stableFieldId: input.stableFieldId,
			readFence: read ? 1n : 0n,
			editFence: 1n,
		})
		.onConflictDoUpdate({
			target: [
				questpieCrdtSubjectFenceTable.resourceId,
				questpieCrdtSubjectFenceTable.subjectId,
				questpieCrdtSubjectFenceTable.scopeKind,
				questpieCrdtSubjectFenceTable.stableFieldId,
			],
			set: read
				? {
						readFence: sql`${questpieCrdtSubjectFenceTable.readFence} + 1`,
						editFence: sql`${questpieCrdtSubjectFenceTable.editFence} + 1`,
					}
				: {
						editFence: sql`${questpieCrdtSubjectFenceTable.editFence} + 1`,
					},
		});
	await tx
		.update(questpieCrdtSessionTable)
		.set({ closedAt: sql`now()`, closeReason: 3, updatedAt: sql`now()` })
		.where(
			and(
				eq(questpieCrdtSessionTable.resourceId, input.resourceId),
				eq(questpieCrdtSessionTable.subjectId, input.subjectId),
				isNull(questpieCrdtSessionTable.closedAt),
			),
		);
}

function authorityTargetSortKey(state: AuthorityTargetState): string {
	const subject = canonicalCrdtAuthoritySubjectKey(state.subject);
	return `${state.fieldPath ?? ""}\0${state.capability}\0${subject}`;
}

export function canonicalCrdtAuthoritySubjectKey(
	subject: CrdtAuthoritySubject,
): string {
	return subject.kind === "human"
		? `human\0${subject.subjectId}`
		: `agent\0${subject.issuer}\0${subject.subjectId}`;
}

export function orderCrdtAuthorityFencePlans(
	plans: readonly CrdtAuthorityFencePlan[],
): CrdtAuthorityFencePlan[] {
	return [...plans].sort((left, right) =>
		compareCanonicalStrings(
			authorityFenceSortKey(left),
			authorityFenceSortKey(right),
		),
	);
}

function authorityFenceSortKey(plan: CrdtAuthorityFencePlan): string {
	return `${plan.resourceId}\0${plan.subjectId}\0${plan.scopeKind}\0${plan.stableFieldId}\0${plan.capability}`;
}

function compareCanonicalStrings(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

function fieldStatus(binding: typeof questpieCrdtBindingTable.$inferSelect) {
	return {
		format: binding.format === 1 ? ("text" as const) : ("set" as const),
		fieldEpoch: String(binding.fieldEpoch),
		headCursor: String(binding.headFieldCursor),
		projectedCursor: String(binding.projectedFieldCursor),
		canonicalRevision: String(binding.canonicalRevision),
		status: statusName(binding.status),
	};
}

function statusName(status: number): "active" | "retired" | "write_suspended" {
	return status === 1 ? "active" : status === 2 ? "retired" : "write_suspended";
}

function parseCounter(value: unknown): bigint {
	if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
		throw new TypeError("CRDT counter must be a canonical decimal string");
	}
	return BigInt(value);
}

function snapshotSubject(subject: CrdtAuthoritySubject): CrdtAuthoritySubject {
	if (
		!subject?.subjectId ||
		subject.subjectId.length > 512 ||
		(subject.kind !== "human" && subject.kind !== "agent")
	) {
		throw new TypeError("CRDT authority subject is invalid");
	}
	if (subject.kind === "agent") {
		let origin: string;
		try {
			origin = new URL(subject.issuer).origin;
		} catch {
			throw new TypeError("CRDT authority agent issuer is invalid");
		}
		if (origin !== subject.issuer) {
			throw new TypeError("CRDT authority agent issuer is invalid");
		}
	}
	return Object.freeze({ ...subject });
}

function equalSubject(
	a: CrdtAuthoritySubject,
	b: CrdtAuthoritySubject,
): boolean {
	return (
		a.kind === b.kind &&
		a.subjectId === b.subjectId &&
		(a.kind === "human" || (b.kind === "agent" && a.issuer === b.issuer))
	);
}

async function resolveStableFieldId(
	db: CrdtDatabase,
	resourceId: string,
	fieldPath: string,
): Promise<string> {
	const [binding] = await db
		.select({ stableFieldId: questpieCrdtBindingTable.stableFieldId })
		.from(questpieCrdtBindingTable)
		.where(
			and(
				eq(questpieCrdtBindingTable.resourceId, resourceId),
				eq(questpieCrdtBindingTable.sourcePath, fieldPath),
				isNull(questpieCrdtBindingTable.retiredAt),
			),
		);
	if (!binding) throw new Error("CRDT field is unavailable");
	return binding.stableFieldId;
}

async function resolveSubject(
	db: CrdtDatabase,
	subject: CrdtAuthoritySubject,
): Promise<string> {
	const kind = subject.kind === "human" ? 1 : 2;
	const issuerKey = subject.kind === "agent" ? subject.issuer : "";
	const digest = createHash("sha256")
		.update(
			`questpie-crdt-subject-v1\0${kind}\0${issuerKey}\0${subject.subjectId}`,
		)
		.digest();
	await db
		.insert(questpieCrdtSubjectTable)
		.values({
			kind,
			issuerKey,
			subjectKey: subject.subjectId,
			subjectHash: Buffer.from(digest),
		})
		.onConflictDoNothing();
	const [stored] = await db
		.select({
			id: questpieCrdtSubjectTable.id,
			hash: questpieCrdtSubjectTable.subjectHash,
		})
		.from(questpieCrdtSubjectTable)
		.where(
			and(
				eq(questpieCrdtSubjectTable.kind, kind),
				eq(questpieCrdtSubjectTable.issuerKey, issuerKey),
				eq(questpieCrdtSubjectTable.subjectKey, subject.subjectId),
			),
		);
	if (!stored || !Buffer.from(stored.hash).equals(digest)) {
		throw new Error("CRDT authority subject identity conflict");
	}
	return stored.id;
}
