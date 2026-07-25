import { createHash } from "node:crypto";

import { and, asc, eq, gt, inArray, isNull, lte, sql } from "drizzle-orm";

import type { AnyDrizzleClient } from "#questpie/server/config/types.js";
import type {
	CrdtEngineFormat,
	CrdtEngineReplica,
	CrdtFieldEngine,
} from "#questpie/shared/crdt-engine.js";
import {
	hashCrdtSubmittedAggregateBundle,
	stageCrdtAggregateBundle,
} from "#questpie/shared/crdt-engine.js";

import {
	createCrdtAppendStore,
	type CrdtAppendReceipt,
	loadCrdtAuthoritativeReplica,
	prepareCrdtAppend,
} from "./append-store.js";
import {
	questpieCrdtBindingTable,
	questpieCrdtResourceEpochTable,
	questpieCrdtResourceTable,
	questpieCrdtSchemaCompatibilityFieldTable,
	questpieCrdtSchemaCompatibilityTable,
	questpieCrdtSchemaTable,
	questpieCrdtSessionGrantTable,
	questpieCrdtSessionTable,
	questpieCrdtSnapshotManifestTable,
	questpieCrdtSnapshotTable,
	questpieCrdtUpdateTable,
} from "./schema.js";
import type {
	CrdtSyncAuthorityBasis,
	CrdtSyncReceiptQueryEntry,
	CrdtSyncSource,
	CrdtSyncSubmittedUpdate,
} from "./sync.js";
import { CrdtSyncRecoveryRequiredError } from "./sync.js";

type CrdtDatabase = AnyDrizzleClient<any>;
type AnyEngine = CrdtFieldEngine<CrdtEngineFormat, any>;
type AppendStoreOptions = Parameters<typeof createCrdtAppendStore>[1];

/**
 * Durable append and receipt source for the bounded Fetch exchange.
 */
export function createCrdtDatabaseSyncSource(
	db: CrdtDatabase,
	input: Readonly<{
		resolveEngine(binding: {
			format: number;
			formatVersion: number;
		}): AnyEngine;
		lockOwnerRow: AppendStoreOptions["lockOwnerRow"];
		publishNotice: NonNullable<AppendStoreOptions["publishNotice"]>;
	}>,
): CrdtSyncSource {
	const appendStore = createCrdtAppendStore(db, {
		lockOwnerRow: input.lockOwnerRow,
		publishNotice: input.publishNotice,
	});
	const source: CrdtSyncSource = {
		async captureAuthorityBasis(sessionId) {
			return db.transaction(
				(transaction) =>
					captureCrdtAuthorityBasis(transaction as CrdtDatabase, sessionId),
				{
					accessMode: "read only",
					isolationLevel: "repeatable read",
				},
			);
		},

		async submitUpdate(basis, submitted) {
			const update = snapshotSubmittedUpdate(submitted);
			assertSubmittedUpdateMatchesBasis(basis, update);
			const submittedHash = await hashCrdtSubmittedAggregateBundle({
				aggregateEpoch: update.aggregateEpoch,
				schemaVersion: update.schemaVersion,
				parts: update.parts,
			});
			const updateId = bytesToUuid(update.updateId);
			const context = await readCurrentAppendContext(db, basis, "receipt");
			const [existing] = await appendStore.reconcileReceipts({
				resourceId: basis.resourceId,
				resourceEpochId: basis.resourceEpochId,
				sessionId: basis.sessionId,
				subjectId: context.session.subjectId,
				authority: context.authority,
				entries: [
					{
						updateId,
						submittedBundleHash: submittedHash,
						submittedSchemaVersion: BigInt(update.schemaVersion),
					},
				],
			});
			if (existing) return toSyncReceipt(existing);
			try {
				const receipt = await appendStore.appendWithRestage(async () => {
					const current = await readCurrentAppendContext(db, basis, "edit");
					const grantsBySlot = new Map(
						current.grants.map((grant) => [grant.fieldSlot, grant]),
					);
					const bindingsBySlot = new Map(
						current.activeBindings.map((binding) => [
							binding.fieldSlot,
							binding,
						]),
					);
					const compatibleParts =
						update.schemaVersion === basis.schemaVersion
							? update.parts.map((part) => ({
									submitted: part,
									fieldSlot: part.fieldSlot,
								}))
							: await mapCompatibleSubmittedParts(db, {
									basis,
									update,
									definitionId: current.resource.definitionId,
									activeBindings: current.activeBindings,
								});
					const authoritative = await Promise.all(
						compatibleParts.map(({ submitted, fieldSlot }) => {
							const grant = grantsBySlot.get(fieldSlot);
							const binding = bindingsBySlot.get(fieldSlot);
							if (
								!grant ||
								!binding ||
								grant.grant !== 1 ||
								grant.bindingId !== binding.id ||
								grant.stableFieldId !== binding.stableFieldId ||
								grant.fieldEpoch !== binding.fieldEpoch ||
								grant.formatVersion !== binding.formatVersion ||
								grant.fieldReadFence !== binding.readFence ||
								grant.fieldEditFence !== binding.editFence ||
								(update.schemaVersion === basis.schemaVersion &&
									(submitted.fieldEpoch !== binding.fieldEpoch ||
										submitted.formatVersion !== binding.formatVersion))
							) {
								throw rejected();
							}
							const engine = input.resolveEngine(binding);
							if (
								engine.formatVersion !== binding.formatVersion ||
								(engine.format === "text" ? 1 : 2) !== binding.format
							) {
								throw rejected();
							}
							return loadCrdtAuthoritativeReplica(db, {
								bindingId: binding.id,
								engine,
							}).then((replica) => ({ engine, replica }));
						}),
					);
					const staged = await stageCrdtAggregateBundle({
						aggregateEpoch: update.aggregateEpoch,
						submittedSchemaVersion: update.schemaVersion,
						canonicalSchemaVersion: current.schemaVersion,
						parts: compatibleParts.map(({ submitted, fieldSlot }, index) => ({
							fieldSlot,
							engine: authoritative[index]!.engine,
							replica: authoritative[index]!.replica.replica,
							update: submitted.bytes,
							submitted: {
								fieldSlot: submitted.fieldSlot,
								fieldEpoch: submitted.fieldEpoch,
								formatVersion: submitted.formatVersion,
								baseFieldCursor: submitted.baseFieldCursor,
							},
						})),
					});
					return prepareCrdtAppend({
						resourceId: basis.resourceId,
						resourceEpochId: basis.resourceEpochId,
						definitionId: current.resource.definitionId,
						schemaId: basis.schemaId,
						sessionId: basis.sessionId,
						subjectId: current.session.subjectId,
						updateId,
						submittedSchemaId:
							update.schemaVersion === basis.schemaVersion
								? basis.schemaId
								: await resolveSchemaId(
										db,
										current.resource.definitionId,
										update.schemaVersion,
									),
						decisionExpiresAt: new Date(Date.now() + 5_000),
						authority: current.authority,
						overlay: current.activeBindings.map((binding) => ({
							bindingId: binding.id,
							stableFieldId: binding.stableFieldId,
							fieldEpoch: binding.fieldEpoch,
							fieldCursor: binding.headFieldCursor,
							readFence: binding.readFence,
							editFence: binding.editFence,
						})),
						staged,
						authoritative: authoritative.map((part) => part.replica),
					});
				});
				return toSyncReceipt(receipt);
			} catch (error) {
				if (error instanceof CrdtSyncRecoveryRequiredError) throw error;
				throw rejected();
			}
		},
		async reconcileReceipts(basis, submittedEntries) {
			const entries = snapshotReceiptEntries(submittedEntries);
			if (entries.length === 0) return [];
			for (const entry of entries) {
				if (
					entry.aggregateEpoch !== basis.aggregateEpoch ||
					entry.schemaVersion > basis.schemaVersion
				) {
					throw rejected();
				}
			}
			const context = await readCurrentAppendContext(db, basis, "receipt");
			const receipts = await appendStore.reconcileReceipts({
				resourceId: basis.resourceId,
				resourceEpochId: basis.resourceEpochId,
				sessionId: basis.sessionId,
				subjectId: context.session.subjectId,
				authority: context.authority,
				entries: entries.map((entry) => ({
					updateId: bytesToUuid(entry.updateId),
					submittedBundleHash: entry.submittedHash,
					submittedSchemaVersion: BigInt(entry.schemaVersion),
				})),
			});
			const receiptsById = new Map(
				receipts.map((receipt) => [receipt.updateId, receipt]),
			);
			return Object.freeze(
				entries.flatMap((entry) => {
					const receipt = receiptsById.get(bytesToUuid(entry.updateId));
					return receipt ? [toSyncReceipt(receipt)] : [];
				}),
			);
		},
	};
	return source;
}

async function captureCrdtAuthorityBasis(
	db: CrdtDatabase,
	sessionId: string,
): Promise<CrdtSyncAuthorityBasis> {
	const [session] = await db
		.select()
		.from(questpieCrdtSessionTable)
		.where(
			and(
				eq(questpieCrdtSessionTable.id, sessionId),
				isNull(questpieCrdtSessionTable.closedAt),
				gt(questpieCrdtSessionTable.leaseExpiresAt, sql`clock_timestamp()`),
				gt(questpieCrdtSessionTable.authorityExpiresAt, sql`clock_timestamp()`),
			),
		)
		.limit(1);
	if (!session) throw rejected();
	const [epoch] = await db
		.select()
		.from(questpieCrdtResourceEpochTable)
		.where(
			and(
				eq(questpieCrdtResourceEpochTable.resourceId, session.resourceId),
				eq(questpieCrdtResourceEpochTable.id, session.resourceEpochId),
				eq(questpieCrdtResourceEpochTable.schemaId, session.schemaId),
				eq(questpieCrdtResourceEpochTable.status, 1),
			),
		)
		.limit(1);
	if (!epoch) throw rejected();
	const [schema] = await db
		.select({ version: questpieCrdtSchemaTable.schemaVersion })
		.from(questpieCrdtSchemaTable)
		.where(eq(questpieCrdtSchemaTable.id, session.schemaId))
		.limit(1);
	if (!schema || schema.version < 0n || schema.version > BigInt(0xffff_ffff)) {
		throw rejected();
	}
	const grants = await db
		.select({
			bindingId: questpieCrdtSessionGrantTable.bindingId,
			fieldSlot: questpieCrdtSessionGrantTable.fieldSlot,
			fieldEpoch: questpieCrdtSessionGrantTable.fieldEpoch,
			grant: questpieCrdtSessionGrantTable.grant,
			fieldReadFence: questpieCrdtSessionGrantTable.fieldReadFence,
			fieldEditFence: questpieCrdtSessionGrantTable.fieldEditFence,
		})
		.from(questpieCrdtSessionGrantTable)
		.where(eq(questpieCrdtSessionGrantTable.sessionId, sessionId))
		.orderBy(asc(questpieCrdtSessionGrantTable.fieldSlot));
	const readable = grants.filter((grant) => grant.grant >= 0);
	const bindings =
		readable.length === 0
			? []
			: await db
					.select()
					.from(questpieCrdtBindingTable)
					.where(
						and(
							eq(questpieCrdtBindingTable.resourceId, session.resourceId),
							inArray(
								questpieCrdtBindingTable.id,
								readable.map((grant) => grant.bindingId),
							),
							eq(questpieCrdtBindingTable.status, 1),
							isNull(questpieCrdtBindingTable.retiredAt),
						),
					);
	const bindingsById = new Map(
		bindings.map((binding) => [binding.id, binding]),
	);
	const fields = readable.map((grant) => {
		const binding = bindingsById.get(grant.bindingId);
		if (
			!binding ||
			(grant.grant !== 0 && grant.grant !== 1) ||
			binding.schemaId !== session.schemaId ||
			binding.fieldSlot !== grant.fieldSlot ||
			binding.fieldEpoch !== grant.fieldEpoch ||
			binding.readFence !== grant.fieldReadFence ||
			binding.editFence !== grant.fieldEditFence
		) {
			throw rejected();
		}
		return Object.freeze({
			bindingId: binding.id,
			fieldSlot: binding.fieldSlot,
			fieldEpoch: binding.fieldEpoch,
			grant: grant.grant,
			formatVersion: binding.formatVersion,
			readFence: binding.readFence,
			editFence: binding.editFence,
			fieldCursor: binding.headFieldCursor,
		});
	});
	return Object.freeze({
		sessionId,
		bindingId: session.bindingId,
		sessionGeneration: session.generation,
		deliveryGeneration: session.deliveryGeneration,
		resourceId: session.resourceId,
		resourceEpochId: session.resourceEpochId,
		schemaId: session.schemaId,
		aggregateEpoch: epoch.aggregateEpoch,
		schemaVersion: Number(schema.version),
		fields: Object.freeze(fields),
	});
}

function snapshotSubmittedUpdate(
	input: CrdtSyncSubmittedUpdate,
): CrdtSyncSubmittedUpdate {
	const updateId = new Uint8Array(input.updateId);
	if (updateId.byteLength !== 16) throw rejected();
	const parts = input.parts.map((part) =>
		Object.freeze({
			fieldSlot: part.fieldSlot,
			fieldEpoch: part.fieldEpoch,
			formatVersion: part.formatVersion,
			baseFieldCursor: part.baseFieldCursor,
			bytes: new Uint8Array(part.bytes),
		}),
	);
	return Object.freeze({
		updateId,
		aggregateEpoch: input.aggregateEpoch,
		schemaVersion: input.schemaVersion,
		parts: Object.freeze(parts),
	});
}

function snapshotReceiptEntries(
	input: readonly CrdtSyncReceiptQueryEntry[],
): readonly CrdtSyncReceiptQueryEntry[] {
	if (input.length > 64) throw rejected();
	const entries = input.map((entry) => {
		const updateId = new Uint8Array(entry.updateId);
		const submittedHash = new Uint8Array(entry.submittedHash);
		if (updateId.byteLength !== 16 || submittedHash.byteLength !== 32) {
			throw rejected();
		}
		return Object.freeze({
			updateId,
			submittedHash,
			aggregateEpoch: entry.aggregateEpoch,
			schemaVersion: entry.schemaVersion,
		});
	});
	const ids = entries.map((entry) => bytesToUuid(entry.updateId));
	if (new Set(ids).size !== ids.length) throw rejected();
	return Object.freeze(entries);
}

function assertSubmittedUpdateMatchesBasis(
	basis: CrdtSyncAuthorityBasis,
	update: CrdtSyncSubmittedUpdate,
): void {
	if (
		update.aggregateEpoch !== basis.aggregateEpoch ||
		update.schemaVersion > basis.schemaVersion
	) {
		throw rejected();
	}
	bytesToUuid(update.updateId);
}

async function resolveSchemaId(
	db: CrdtDatabase,
	definitionId: string,
	schemaVersion: number,
): Promise<string> {
	const schemas = await db
		.select({ id: questpieCrdtSchemaTable.id })
		.from(questpieCrdtSchemaTable)
		.where(
			and(
				eq(questpieCrdtSchemaTable.definitionId, definitionId),
				eq(questpieCrdtSchemaTable.schemaVersion, BigInt(schemaVersion)),
			),
		)
		.limit(2);
	if (schemas.length !== 1) throw new CrdtSyncRecoveryRequiredError();
	return schemas[0]!.id;
}

async function mapCompatibleSubmittedParts(
	db: CrdtDatabase,
	input: Readonly<{
		basis: CrdtSyncAuthorityBasis;
		update: CrdtSyncSubmittedUpdate;
		definitionId: string;
		activeBindings: readonly (typeof questpieCrdtBindingTable.$inferSelect)[];
	}>,
): Promise<
	readonly Readonly<{
		submitted: CrdtSyncSubmittedUpdate["parts"][number];
		fieldSlot: number;
	}>[]
> {
	const sourceSchemaId = await resolveSchemaId(
		db,
		input.definitionId,
		input.update.schemaVersion,
	);
	const compatibility = await db
		.select()
		.from(questpieCrdtSchemaCompatibilityTable)
		.where(
			and(
				eq(
					questpieCrdtSchemaCompatibilityTable.resourceId,
					input.basis.resourceId,
				),
				eq(
					questpieCrdtSchemaCompatibilityTable.resourceEpochId,
					input.basis.resourceEpochId,
				),
				eq(
					questpieCrdtSchemaCompatibilityTable.definitionId,
					input.definitionId,
				),
				gt(
					questpieCrdtSchemaCompatibilityTable.expiresAt,
					sql`clock_timestamp()`,
				),
			),
		);
	const paths: (typeof compatibility)[] = [];
	const visit = (
		schemaId: string,
		path: typeof compatibility,
		seen: ReadonlySet<string>,
	): void => {
		if (paths.length > 1 || path.length > 32) return;
		if (schemaId === input.basis.schemaId) {
			paths.push(path);
			return;
		}
		for (const edge of compatibility) {
			if (edge.sourceSchemaId !== schemaId || seen.has(edge.targetSchemaId)) {
				continue;
			}
			visit(
				edge.targetSchemaId,
				[...path, edge],
				new Set([...seen, edge.targetSchemaId]),
			);
		}
	};
	visit(sourceSchemaId, [], new Set([sourceSchemaId]));
	if (paths.length !== 1 || paths[0]!.length === 0) {
		throw new CrdtSyncRecoveryRequiredError();
	}
	const path = paths[0]!;
	const mappings = await db
		.select()
		.from(questpieCrdtSchemaCompatibilityFieldTable)
		.where(
			inArray(
				questpieCrdtSchemaCompatibilityFieldTable.compatibilityId,
				path.map((edge) => edge.id),
			),
		);
	const bindingIds = new Set<string>();
	for (const mapping of mappings) {
		bindingIds.add(mapping.sourceBindingId);
		bindingIds.add(mapping.targetBindingId);
	}
	const bindings =
		bindingIds.size === 0
			? []
			: await db
					.select()
					.from(questpieCrdtBindingTable)
					.where(
						and(
							eq(questpieCrdtBindingTable.resourceId, input.basis.resourceId),
							inArray(questpieCrdtBindingTable.id, [...bindingIds]),
						),
					);
	const bindingById = new Map(bindings.map((binding) => [binding.id, binding]));
	const mappingsByCompatibilityId = new Map<string, typeof mappings>();
	for (const edge of path) {
		mappingsByCompatibilityId.set(
			edge.id,
			mappings.filter((mapping) => mapping.compatibilityId === edge.id),
		);
	}
	const activeBySlot = new Map(
		input.activeBindings.map((binding) => [binding.fieldSlot, binding]),
	);
	const mapped = input.update.parts.map((submitted) => {
		let fieldSlot = submitted.fieldSlot;
		let fieldEpoch = submitted.fieldEpoch;
		let formatVersion = submitted.formatVersion;
		let stableFieldId: string | undefined;
		let format: number | undefined;
		for (const edge of path) {
			const matches = (mappingsByCompatibilityId.get(edge.id) ?? []).filter(
				(mapping) =>
					mapping.sourceSchemaId === edge.sourceSchemaId &&
					mapping.targetSchemaId === edge.targetSchemaId &&
					mapping.sourceFieldSlot === fieldSlot &&
					mapping.sourceFieldEpoch === fieldEpoch &&
					mapping.sourceFormatVersion === formatVersion,
			);
			if (matches.length !== 1) {
				throw new CrdtSyncRecoveryRequiredError();
			}
			const mapping = matches[0]!;
			const source = bindingById.get(mapping.sourceBindingId);
			const target = bindingById.get(mapping.targetBindingId);
			if (
				!source ||
				!target ||
				source.schemaId !== edge.sourceSchemaId ||
				target.schemaId !== edge.targetSchemaId ||
				source.schemaFieldId !== mapping.sourceSchemaFieldId ||
				target.schemaFieldId !== mapping.targetSchemaFieldId ||
				source.stableFieldId !== target.stableFieldId ||
				source.format !== target.format ||
				source.formatVersion !== target.formatVersion ||
				source.fieldSlot !== mapping.sourceFieldSlot ||
				source.fieldEpoch !== mapping.sourceFieldEpoch ||
				source.formatVersion !== mapping.sourceFormatVersion ||
				target.fieldSlot !== mapping.targetFieldSlot ||
				target.fieldEpoch !== mapping.targetFieldEpoch ||
				target.formatVersion !== mapping.targetFormatVersion ||
				(stableFieldId !== undefined &&
					stableFieldId !== source.stableFieldId) ||
				(format !== undefined && format !== source.format)
			) {
				throw new CrdtSyncRecoveryRequiredError();
			}
			stableFieldId = target.stableFieldId;
			format = target.format;
			fieldSlot = target.fieldSlot;
			fieldEpoch = target.fieldEpoch;
			formatVersion = target.formatVersion;
		}
		const active = activeBySlot.get(fieldSlot);
		if (
			!active ||
			active.schemaId !== input.basis.schemaId ||
			active.stableFieldId !== stableFieldId ||
			active.format !== format ||
			active.fieldEpoch !== fieldEpoch ||
			active.formatVersion !== formatVersion ||
			active.status !== 1 ||
			active.retiredAt !== null
		) {
			throw new CrdtSyncRecoveryRequiredError();
		}
		return Object.freeze({ submitted, fieldSlot });
	});
	mapped.sort((left, right) => left.fieldSlot - right.fieldSlot);
	if (new Set(mapped.map((part) => part.fieldSlot)).size !== mapped.length) {
		throw new CrdtSyncRecoveryRequiredError();
	}
	return Object.freeze(mapped);
}

async function readCurrentAppendContext(
	db: CrdtDatabase,
	basis: CrdtSyncAuthorityBasis,
	capability: "read" | "receipt" | "edit",
) {
	const [session] = await db
		.select()
		.from(questpieCrdtSessionTable)
		.where(
			and(
				eq(questpieCrdtSessionTable.id, basis.sessionId),
				eq(questpieCrdtSessionTable.resourceId, basis.resourceId),
				eq(questpieCrdtSessionTable.resourceEpochId, basis.resourceEpochId),
				eq(questpieCrdtSessionTable.schemaId, basis.schemaId),
				...(basis.bindingId === undefined
					? []
					: [eq(questpieCrdtSessionTable.bindingId, basis.bindingId)]),
				...(basis.sessionGeneration === undefined
					? []
					: [eq(questpieCrdtSessionTable.generation, basis.sessionGeneration)]),
				...(basis.deliveryGeneration === undefined
					? []
					: [
							eq(
								questpieCrdtSessionTable.deliveryGeneration,
								basis.deliveryGeneration,
							),
						]),
				isNull(questpieCrdtSessionTable.closedAt),
				gt(questpieCrdtSessionTable.authorityExpiresAt, sql`clock_timestamp()`),
				gt(questpieCrdtSessionTable.leaseExpiresAt, sql`clock_timestamp()`),
			),
		)
		.limit(1);
	const [resource] = await db
		.select()
		.from(questpieCrdtResourceTable)
		.where(
			and(
				eq(questpieCrdtResourceTable.id, basis.resourceId),
				eq(questpieCrdtResourceTable.currentEpochId, basis.resourceEpochId),
				eq(questpieCrdtResourceTable.status, 1),
				isNull(questpieCrdtResourceTable.retiredAt),
			),
		)
		.limit(1);
	const [epoch] = await db
		.select()
		.from(questpieCrdtResourceEpochTable)
		.where(
			and(
				eq(questpieCrdtResourceEpochTable.id, basis.resourceEpochId),
				eq(questpieCrdtResourceEpochTable.resourceId, basis.resourceId),
				eq(questpieCrdtResourceEpochTable.schemaId, basis.schemaId),
				eq(questpieCrdtResourceEpochTable.aggregateEpoch, basis.aggregateEpoch),
				eq(questpieCrdtResourceEpochTable.status, 1),
			),
		)
		.limit(1);
	const [schema] = resource
		? await db
				.select({ version: questpieCrdtSchemaTable.schemaVersion })
				.from(questpieCrdtSchemaTable)
				.where(
					and(
						eq(questpieCrdtSchemaTable.id, basis.schemaId),
						eq(questpieCrdtSchemaTable.definitionId, resource.definitionId),
					),
				)
				.limit(1)
		: [];
	if (
		!session ||
		!resource ||
		!epoch ||
		!schema ||
		schema.version !== BigInt(basis.schemaVersion) ||
		epoch.definitionId !== resource.definitionId ||
		session.generation !== resource.sessionGeneration ||
		session.resourceReadFence !== resource.readFence ||
		session.ownerPolicyRevision !== resource.ownerPolicyRevision ||
		(capability === "edit" &&
			(session.effectiveMode !== 2 ||
				session.resourceEditFence !== resource.editFence))
	) {
		throw rejected();
	}
	const grants = await db
		.select()
		.from(questpieCrdtSessionGrantTable)
		.where(eq(questpieCrdtSessionGrantTable.sessionId, basis.sessionId))
		.orderBy(asc(questpieCrdtSessionGrantTable.fieldSlot));
	if (
		grants.length !== basis.fields.length ||
		grants.some((grant, index) => {
			const field = basis.fields[index];
			return (
				!field ||
				grant.resourceId !== basis.resourceId ||
				grant.schemaId !== basis.schemaId ||
				grant.bindingId !== field.bindingId ||
				grant.fieldSlot !== field.fieldSlot ||
				grant.fieldEpoch !== field.fieldEpoch ||
				grant.formatVersion !== field.formatVersion ||
				(capability === "receipt"
					? !(
							grant.grant === field.grant ||
							(field.grant === 1 && grant.grant === 0)
						)
					: grant.grant !== field.grant) ||
				grant.fieldReadFence !== field.readFence ||
				grant.fieldEditFence !== field.editFence
			);
		})
	) {
		throw rejected();
	}
	const activeBindings = await db
		.select()
		.from(questpieCrdtBindingTable)
		.where(
			and(
				eq(questpieCrdtBindingTable.resourceId, basis.resourceId),
				eq(questpieCrdtBindingTable.status, 1),
				isNull(questpieCrdtBindingTable.retiredAt),
			),
		)
		.orderBy(asc(questpieCrdtBindingTable.id));
	if (activeBindings.some((binding) => binding.schemaId !== basis.schemaId)) {
		throw rejected();
	}
	return Object.freeze({
		session,
		resource,
		schemaVersion: Number(schema.version),
		grants: Object.freeze(grants),
		activeBindings: Object.freeze(activeBindings),
		authority: Object.freeze({
			resourceReadFence: session.resourceReadFence,
			resourceEditFence: session.resourceEditFence,
			ownerPolicyRevision: session.ownerPolicyRevision,
			subjectReadFence: session.subjectReadFence,
			subjectEditFence: session.subjectEditFence,
			sessionGeneration: session.generation,
		}),
	});
}

function toSyncReceipt(receipt: CrdtAppendReceipt) {
	return Object.freeze({
		updateId: uuidBytes(receipt.updateId),
		cursors: Object.freeze(
			receipt.fieldCursors.map((cursor) =>
				Object.freeze({
					fieldSlot: cursor.fieldSlot,
					fieldCursor: cursor.fieldCursor,
				}),
			),
		),
	});
}

export async function materializeCrdtAggregateAtCut(
	db: CrdtDatabase,
	input: {
		resourceId: string;
		resourceEpochId: string;
		schemaId: string;
		targetCommitSeq: bigint;
		currentManifestId: string | null;
		previousManifestId: string | null;
		bindings: readonly (typeof questpieCrdtBindingTable.$inferSelect)[];
		engines: ReadonlyMap<number, AnyEngine>;
		targetFieldCursors: ReadonlyMap<string, bigint>;
	},
): Promise<Map<number, CrdtEngineReplica<CrdtEngineFormat, any>> | null> {
	for (const manifestId of [
		input.currentManifestId,
		input.previousManifestId,
	]) {
		if (!manifestId) continue;
		try {
			const [manifest] = await db
				.select()
				.from(questpieCrdtSnapshotManifestTable)
				.where(
					and(
						eq(questpieCrdtSnapshotManifestTable.id, manifestId),
						eq(questpieCrdtSnapshotManifestTable.resourceId, input.resourceId),
						eq(
							questpieCrdtSnapshotManifestTable.resourceEpochId,
							input.resourceEpochId,
						),
						eq(questpieCrdtSnapshotManifestTable.schemaId, input.schemaId),
						eq(questpieCrdtSnapshotManifestTable.status, 2),
						lte(
							questpieCrdtSnapshotManifestTable.coversCommitSeq,
							input.targetCommitSeq,
						),
					),
				)
				.limit(1);
			if (!manifest?.verifiedAt) continue;
			const snapshots =
				input.bindings.length === 0
					? []
					: await db
							.select()
							.from(questpieCrdtSnapshotTable)
							.where(
								and(
									eq(questpieCrdtSnapshotTable.manifestId, manifestId),
									inArray(
										questpieCrdtSnapshotTable.bindingId,
										input.bindings.map((binding) => binding.id),
									),
								),
							);
			if (snapshots.length !== input.bindings.length) continue;
			const snapshotsByBinding = new Map(
				snapshots.map((snapshot) => [snapshot.bindingId, snapshot]),
			);
			const result = new Map<
				number,
				CrdtEngineReplica<CrdtEngineFormat, any>
			>();
			for (const binding of input.bindings) {
				const engine = input.engines.get(binding.fieldSlot);
				const snapshot = snapshotsByBinding.get(binding.id);
				const targetFieldCursor = input.targetFieldCursors.get(binding.id);
				if (
					!engine ||
					!snapshot ||
					targetFieldCursor === undefined ||
					snapshot.fieldCursor > targetFieldCursor ||
					snapshot.schemaId !== input.schemaId ||
					snapshot.fieldEpoch !== binding.fieldEpoch ||
					snapshot.fieldSlot !== binding.fieldSlot ||
					snapshot.formatVersion !== binding.formatVersion ||
					snapshot.engineId !== engine.engineId ||
					snapshot.engineVersion !== engine.engineVersion ||
					snapshot.stateVersion !== engine.stateVersion ||
					snapshot.sizeBytes !== snapshot.bytes.byteLength ||
					!equalBytes(
						createHash("sha256").update(snapshot.bytes).digest(),
						snapshot.checksum,
					)
				) {
					throw rejected();
				}
				let replica = await engine.restore({
					snapshot: new Uint8Array(snapshot.bytes),
					basis: {
						fieldEpoch: snapshot.fieldEpoch,
						fieldCursor: snapshot.fieldCursor,
					},
				});
				if (
					replica.engineId !== engine.engineId ||
					replica.format !== engine.format ||
					replica.formatVersion !== engine.formatVersion ||
					replica.basis.fieldEpoch !== snapshot.fieldEpoch ||
					replica.basis.fieldCursor !== snapshot.fieldCursor ||
					!equalBytes(replica.state, snapshot.bytes)
				) {
					throw rejected();
				}
				const updates = await db
					.select()
					.from(questpieCrdtUpdateTable)
					.where(
						and(
							eq(questpieCrdtUpdateTable.resourceId, input.resourceId),
							eq(
								questpieCrdtUpdateTable.resourceEpochId,
								input.resourceEpochId,
							),
							eq(questpieCrdtUpdateTable.bindingId, binding.id),
							gt(questpieCrdtUpdateTable.fieldCursor, snapshot.fieldCursor),
							lte(questpieCrdtUpdateTable.fieldCursor, targetFieldCursor),
						),
					)
					.orderBy(asc(questpieCrdtUpdateTable.fieldCursor));
				for (const update of updates) {
					if (
						update.schemaId !== input.schemaId ||
						update.fieldEpoch !== binding.fieldEpoch ||
						update.fieldSlot !== binding.fieldSlot ||
						update.formatVersion !== binding.formatVersion ||
						update.baseFieldCursor !== replica.basis.fieldCursor ||
						update.fieldCursor !== replica.basis.fieldCursor + 1n ||
						update.sizeBytes !== update.bytes.byteLength ||
						!equalBytes(
							createHash("sha256").update(update.bytes).digest(),
							update.checksum,
						)
					) {
						throw rejected();
					}
					const candidate = await engine.stage({
						replica,
						update: new Uint8Array(update.bytes),
					});
					replica = await engine.commit({
						candidate,
						current: replica,
						assignedFieldCursor: update.fieldCursor,
					});
				}
				if (replica.basis.fieldCursor !== targetFieldCursor) {
					throw rejected();
				}
				result.set(binding.fieldSlot, replica);
			}
			return result;
		} catch {
			// One bad component rejects the whole candidate manifest.
		}
	}
	return null;
}

function rejected(): Error {
	return new Error("CRDT synchronization rejected");
}

function uuidBytes(value: string): Uint8Array {
	const hex = value.replaceAll("-", "");
	if (!/^[a-f0-9]{32}$/i.test(hex)) throw rejected();
	return Uint8Array.from(
		Array.from({ length: 16 }, (_, index) =>
			Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16),
		),
	);
}

function bytesToUuid(value: Uint8Array): string {
	if (!(value instanceof Uint8Array) || value.byteLength !== 16) {
		throw rejected();
	}
	const hex = Array.from(value, (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(
		12,
		16,
	)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	return (
		left.byteLength === right.byteLength &&
		left.every((byte, index) => byte === right[index])
	);
}
