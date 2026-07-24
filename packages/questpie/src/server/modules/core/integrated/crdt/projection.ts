const MAX_PROJECTION_FIELDS = 32;

export type CrdtProjectionClaim = Readonly<{
	id: string;
	resourceId: string;
	resourceEpochId: string;
	aggregateEpoch: bigint;
	schemaId: string;
	targetCommitSeq: bigint;
	leaseGeneration: bigint;
}>;

export type CrdtProjectionField = Readonly<{
	bindingId: string;
	stableFieldId: string;
	fieldEpoch: bigint;
	targetFieldCursor: bigint;
	canonicalHash: Uint8Array;
	canonicalRevision: bigint;
	value: string | readonly string[];
	shouldWrite: boolean;
}>;

export type CrdtPreparedProjection = Readonly<{
	claim: CrdtProjectionClaim;
	basisProjectedCommitSeq: bigint;
	fields: readonly CrdtProjectionField[];
}>;

export type CrdtProjectionCommitResult =
	| Readonly<{ status: "applied"; projectedCommitSeq: bigint }>
	| Readonly<{ status: "noop"; projectedCommitSeq: bigint }>
	| Readonly<{ status: "reprepare"; projectedCommitSeq: bigint }>
	| Readonly<{ status: "suspended"; projectedCommitSeq: bigint }>;

export type CrdtProjectionAdapter = Readonly<{
	claimDue(): Promise<CrdtProjectionClaim | null>;
	prepareExactCut(claim: CrdtProjectionClaim): Promise<{
		basisProjectedCommitSeq: bigint;
		fields: readonly CrdtProjectionField[];
	}>;
	commit(prepared: CrdtPreparedProjection): Promise<CrdtProjectionCommitResult>;
}>;

const preparedProofs = new WeakSet<object>();

export function createCrdtProjectionCoordinator(
	adapter: CrdtProjectionAdapter,
) {
	return Object.freeze({
		async runOnce(): Promise<CrdtProjectionCommitResult | null> {
			const claim = snapshotClaim(await adapter.claimDue());
			if (!claim) return null;
			const prepared = await prepare(adapter, claim);
			const result = await adapter.commit(prepared);
			if (!preparedProofs.has(prepared)) {
				throw new TypeError("projection adapter received an unverified plan");
			}
			if (
				result.projectedCommitSeq < 0n ||
				(result.status !== "noop" &&
					result.projectedCommitSeq > claim.targetCommitSeq) ||
				(result.status === "applied" &&
					result.projectedCommitSeq !== claim.targetCommitSeq) ||
				(result.status === "noop" &&
					result.projectedCommitSeq < claim.targetCommitSeq)
			) {
				throw new TypeError("projection adapter returned an invalid result");
			}
			return Object.freeze({ ...result });
		},
	});
}

async function prepare(
	adapter: CrdtProjectionAdapter,
	claim: CrdtProjectionClaim,
): Promise<CrdtPreparedProjection> {
	const candidate = await adapter.prepareExactCut(claim);
	if (
		candidate.basisProjectedCommitSeq < 0n ||
		candidate.basisProjectedCommitSeq >= claim.targetCommitSeq ||
		candidate.fields.length < 1 ||
		candidate.fields.length > MAX_PROJECTION_FIELDS
	) {
		throw new TypeError("projection materialization returned an invalid cut");
	}
	const bindingIds = new Set<string>();
	const stableFieldIds = new Set<string>();
	const fields = [...candidate.fields]
		.map((field) => {
			if (
				bindingIds.has(field.bindingId) ||
				stableFieldIds.has(field.stableFieldId) ||
				field.fieldEpoch < 0n ||
				field.targetFieldCursor < 0n ||
				field.canonicalRevision < 0n ||
				field.canonicalHash.byteLength !== 32
			) {
				throw new TypeError("projection materialization is not canonical");
			}
			bindingIds.add(field.bindingId);
			stableFieldIds.add(field.stableFieldId);
			return Object.freeze({
				...field,
				canonicalHash: field.canonicalHash.slice(),
				value: Array.isArray(field.value)
					? Object.freeze([...field.value])
					: field.value,
			}) as CrdtProjectionField;
		})
		.sort((left, right) => left.bindingId.localeCompare(right.bindingId));
	const prepared = Object.freeze({
		claim,
		basisProjectedCommitSeq: candidate.basisProjectedCommitSeq,
		fields: Object.freeze(fields),
	});
	preparedProofs.add(prepared);
	return prepared;
}

function snapshotClaim(
	claim: CrdtProjectionClaim | null,
): CrdtProjectionClaim | null {
	if (!claim) return null;
	if (
		claim.aggregateEpoch < 0n ||
		claim.targetCommitSeq < 1n ||
		claim.leaseGeneration < 0n
	) {
		throw new TypeError("projection claim contains an invalid cursor");
	}
	return Object.freeze({ ...claim });
}
