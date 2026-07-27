import { Buffer } from "node:buffer";

import type { CrdtAuthentication } from "./authority.js";

type CrdtMode = "view" | "edit";

export type CrdtTargetV1 = Readonly<{
	namespace: string;
	owner:
		| Readonly<{
				kind: "collection";
				key: string;
				id: string | number;
		  }>
		| Readonly<{ kind: "global"; key: string }>;
	mode: CrdtMode;
	fallback?: "view";
}>;

export type CrdtAuthorizationInputV1 =
	| Readonly<{
			purpose: "issue";
			request: Request;
			authentication: CrdtAuthentication;
			target: CrdtTargetV1;
			origin: string | null;
			audience: string;
	  }>
	| Readonly<{
			purpose: "exchange";
			request: Request;
			authentication: CrdtAuthentication;
			resourceId: string;
			requestedMode: CrdtMode;
			effectiveMode: CrdtMode;
			origin: string | null;
			audience: string;
	  }>;

export type CrdtAuthorizedGrant = Readonly<{
	bindingId: string;
	stableFieldId: string;
	fieldEpoch: bigint;
	fieldSlot: number;
	formatVersion: number;
	grant: CrdtMode;
	headFieldCursor: bigint;
	fieldReadFence: bigint;
	fieldEditFence: bigint;
	subjectFieldReadFence: bigint;
	subjectFieldEditFence: bigint;
}>;

export type CrdtAuthorizedBindingCut = Readonly<{
	bindingId: string;
	stableFieldId: string;
	fieldEpoch: bigint;
	fieldSlot: number;
	formatVersion: number;
	headFieldCursor: bigint;
	fieldReadFence: bigint;
	fieldEditFence: bigint;
}>;

export type CrdtClientManifestViewV1 = Readonly<{
	schemaVersion: number;
	schemaFingerprint: string;
	awarenessEnabled: boolean;
	fields: Readonly<
		Record<
			string,
			Readonly<{
				fieldSlot: number;
				format: "text" | "set";
				formatVersion: number;
				engineId: string;
				grant: CrdtMode;
			}>
		>
	>;
}>;

export type CrdtAuthorizationSnapshot = Readonly<{
	resourceId: string;
	resourceEpochId: string;
	definitionId: string;
	schemaId: string;
	incarnationKey: string;
	subjectId: string;
	credentialFingerprint: Uint8Array;
	audience: string;
	origin: string | null;
	requestedMode: CrdtMode;
	effectiveMode: CrdtMode;
	resourceReadFence: bigint;
	resourceEditFence: bigint;
	ownerPolicyRevision: bigint;
	subjectReadFence: bigint;
	subjectEditFence: bigint;
	sessionGeneration: bigint;
	authorityExpiresAt: Date;
	headCommitSeq: bigint;
	offlineSubjectKey: string;
	clientManifest: CrdtClientManifestViewV1;
	/** Complete active aggregate cut, including fields hidden from this subject. */
	bindings: readonly CrdtAuthorizedBindingCut[];
	/** Readable fields only; hidden fields never enter the durable session. */
	grants: readonly CrdtAuthorizedGrant[];
}>;

export class CrdtAuthorizationRejectedError extends Error {
	constructor() {
		super("CRDT authorization rejected");
		this.name = "CrdtAuthorizationRejectedError";
	}
}

export function snapshotCrdtAuthorization(
	input: CrdtAuthorizationSnapshot,
): CrdtAuthorizationSnapshot {
	if (
		input.credentialFingerprint.byteLength !== 32 ||
		!validUuid(input.resourceId) ||
		!validUuid(input.resourceEpochId) ||
		!validUuid(input.definitionId) ||
		!validUuid(input.schemaId) ||
		!validUuid(input.incarnationKey) ||
		!validUuid(input.subjectId) ||
		!(input.authorityExpiresAt instanceof Date) ||
		!Number.isFinite(input.authorityExpiresAt.getTime()) ||
		!nonnegativeBigints(
			input.resourceReadFence,
			input.resourceEditFence,
			input.ownerPolicyRevision,
			input.subjectReadFence,
			input.subjectEditFence,
			input.sessionGeneration,
			input.headCommitSeq,
		) ||
		input.bindings.length === 0 ||
		input.bindings.length > 32 ||
		input.grants.length === 0 ||
		input.grants.length > 32 ||
		!/^[A-Za-z0-9_-]{43}$/.test(input.offlineSubjectKey) ||
		!validClientManifest(input.clientManifest, input.grants) ||
		byteLength(input.audience) < 1 ||
		byteLength(input.audience) > 255 ||
		(input.origin !== null &&
			(byteLength(input.origin) < 1 || byteLength(input.origin) > 2048)) ||
		(input.requestedMode === "view" && input.effectiveMode !== "view") ||
		(input.effectiveMode === "view" &&
			input.grants.some((grant) => grant.grant !== "view")) ||
		(input.effectiveMode === "edit" &&
			!input.grants.some((grant) => grant.grant === "edit"))
	) {
		throw new TypeError("Invalid CRDT authorization snapshot");
	}
	let previousBinding = "";
	const bindings = input.bindings.map((binding) => {
		if (
			binding.stableFieldId <= previousBinding ||
			!validUuid(binding.bindingId) ||
			!validUuid(binding.stableFieldId) ||
			binding.fieldSlot < 1 ||
			binding.fieldSlot > 65_535 ||
			!Number.isSafeInteger(binding.formatVersion) ||
			binding.formatVersion < 0 ||
			binding.formatVersion > 65_535 ||
			!nonnegativeBigints(
				binding.fieldEpoch,
				binding.headFieldCursor,
				binding.fieldReadFence,
				binding.fieldEditFence,
			)
		) {
			throw new TypeError("Invalid CRDT authorization binding cut");
		}
		previousBinding = binding.stableFieldId;
		return Object.freeze({ ...binding });
	});
	let previous = "";
	const grants = input.grants.map((grant) => {
		const binding = bindings.find(
			(candidate) => candidate.stableFieldId === grant.stableFieldId,
		);
		if (
			grant.stableFieldId <= previous ||
			!validUuid(grant.bindingId) ||
			!validUuid(grant.stableFieldId) ||
			grant.fieldSlot < 1 ||
			grant.fieldSlot > 65_535 ||
			!Number.isSafeInteger(grant.formatVersion) ||
			grant.formatVersion < 0 ||
			grant.formatVersion > 65_535 ||
			!nonnegativeBigints(
				grant.fieldEpoch,
				grant.headFieldCursor,
				grant.fieldReadFence,
				grant.fieldEditFence,
				grant.subjectFieldReadFence,
				grant.subjectFieldEditFence,
			) ||
			(grant.grant !== "view" && grant.grant !== "edit") ||
			!binding ||
			!equalGrantBinding(grant, binding)
		) {
			throw new TypeError("Invalid CRDT authorization grants");
		}
		previous = grant.stableFieldId;
		return Object.freeze({ ...grant });
	});
	return Object.freeze({
		...input,
		credentialFingerprint: Buffer.from(input.credentialFingerprint),
		authorityExpiresAt: new Date(input.authorityExpiresAt),
		clientManifest: snapshotClientManifest(input.clientManifest),
		bindings: Object.freeze(bindings),
		grants: Object.freeze(grants),
	});
}

function validClientManifest(
	manifest: CrdtClientManifestViewV1,
	grants: readonly CrdtAuthorizedGrant[],
): boolean {
	if (
		!manifest ||
		typeof manifest !== "object" ||
		!Number.isSafeInteger(manifest.schemaVersion) ||
		manifest.schemaVersion < 0 ||
		manifest.schemaVersion > 0xffff_ffff ||
		!/^[A-Za-z0-9_-]{43}$/.test(manifest.schemaFingerprint) ||
		typeof manifest.awarenessEnabled !== "boolean" ||
		!manifest.fields ||
		typeof manifest.fields !== "object" ||
		Array.isArray(manifest.fields)
	) {
		return false;
	}
	const fields = Object.entries(manifest.fields);
	if (fields.length !== grants.length) return false;
	const slots = new Set<number>();
	return fields.every(([key, field]) => {
		const grant = grants.find(
			(candidate) => candidate.fieldSlot === field.fieldSlot,
		);
		return (
			byteLength(key) >= 1 &&
			byteLength(key) <= 256 &&
			Number.isSafeInteger(field.fieldSlot) &&
			field.fieldSlot >= 1 &&
			field.fieldSlot <= 0xffff &&
			!slots.has(field.fieldSlot) &&
			(field.format === "text" || field.format === "set") &&
			Number.isSafeInteger(field.formatVersion) &&
			field.formatVersion >= 0 &&
			field.formatVersion <= 0xffff &&
			byteLength(field.engineId) >= 1 &&
			byteLength(field.engineId) <= 128 &&
			(field.grant === "view" || field.grant === "edit") &&
			grant?.formatVersion === field.formatVersion &&
			grant.grant === field.grant &&
			(slots.add(field.fieldSlot), true)
		);
	});
}

function snapshotClientManifest(
	manifest: CrdtClientManifestViewV1,
): CrdtClientManifestViewV1 {
	return Object.freeze({
		schemaVersion: manifest.schemaVersion,
		schemaFingerprint: manifest.schemaFingerprint,
		awarenessEnabled: manifest.awarenessEnabled,
		fields: Object.freeze(
			Object.fromEntries(
				Object.entries(manifest.fields).map(([key, field]) => [
					key,
					Object.freeze({ ...field }),
				]),
			),
		),
	});
}

function equalGrantBinding(
	grant: CrdtAuthorizedGrant,
	binding: CrdtAuthorizedBindingCut,
): boolean {
	return (
		grant.bindingId === binding.bindingId &&
		grant.fieldEpoch === binding.fieldEpoch &&
		grant.fieldSlot === binding.fieldSlot &&
		grant.formatVersion === binding.formatVersion &&
		grant.headFieldCursor === binding.headFieldCursor &&
		grant.fieldReadFence === binding.fieldReadFence &&
		grant.fieldEditFence === binding.fieldEditFence
	);
}

function byteLength(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function validUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
		value,
	);
}

function nonnegativeBigints(...values: bigint[]): boolean {
	return values.every((value) => typeof value === "bigint" && value >= 0n);
}
