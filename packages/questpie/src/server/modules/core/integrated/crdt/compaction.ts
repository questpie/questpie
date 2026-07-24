const COMPACTION_COMMIT_TRIGGER = 512n;
const COMPACTION_BYTE_TRIGGER = 4n * 1024n * 1024n;
const DEFAULT_GC_LIMIT = 256;

export type CrdtCompactionCut = Readonly<{
	resourceId: string;
	resourceEpochId: string;
	schemaId: string;
	coversCommitSeq: bigint;
	leaseOwnerId: string;
	leaseGeneration: bigint;
}>;

export type CrdtCompactionCandidate<TSnapshot> = Readonly<{
	cut: CrdtCompactionCut;
	snapshot: TSnapshot;
}>;

export type CrdtCompactionAdapter<TSnapshot> = Readonly<{
	captureCut(): Promise<CrdtCompactionCut | null>;
	materializeExactCut(cut: CrdtCompactionCut): Promise<TSnapshot>;
	persistVerifiedCandidate(
		candidate: CrdtCompactionCandidate<TSnapshot>,
	): Promise<void>;
	publishVerifiedCandidate(
		candidate: CrdtCompactionCandidate<TSnapshot>,
	): Promise<boolean>;
	collectGarbage(cut: CrdtCompactionCut): Promise<number>;
}>;

export function shouldCompactCrdtAggregate(input: {
	headCommitSeq: bigint;
	currentSnapshotCommitSeq: bigint;
	updateBytesSinceSnapshot: bigint;
}): boolean {
	if (
		input.headCommitSeq < input.currentSnapshotCommitSeq ||
		input.updateBytesSinceSnapshot < 0n
	) {
		throw new TypeError("compaction counters are invalid");
	}
	return (
		input.headCommitSeq - input.currentSnapshotCommitSeq >=
			COMPACTION_COMMIT_TRIGGER ||
		input.updateBytesSinceSnapshot >= COMPACTION_BYTE_TRIGGER
	);
}

export function createCrdtCompactionCoordinator<TSnapshot>(
	adapter: CrdtCompactionAdapter<TSnapshot>,
) {
	return Object.freeze({
		async runOnce(): Promise<
			Readonly<{ status: "idle" | "stale" | "published"; deleted: number }>
		> {
			const cut = snapshotCut(await adapter.captureCut());
			if (!cut) return Object.freeze({ status: "idle", deleted: 0 });
			const candidate = Object.freeze({
				cut,
				snapshot: await adapter.materializeExactCut(cut),
			});
			await adapter.persistVerifiedCandidate(candidate);
			if (!(await adapter.publishVerifiedCandidate(candidate))) {
				return Object.freeze({ status: "stale", deleted: 0 });
			}
			const deleted = await adapter.collectGarbage(cut);
			if (
				!Number.isSafeInteger(deleted) ||
				deleted < 0 ||
				deleted > DEFAULT_GC_LIMIT
			) {
				throw new TypeError("compaction GC exceeded its bounded batch");
			}
			return Object.freeze({ status: "published", deleted });
		},
	});
}

export type CrdtRetentionManifest = Readonly<{
	id: string;
	coversCommitSeq: bigint;
	hasRecentlyRetiredField: boolean;
	hasRecoveryHold: boolean;
}>;

export type CrdtRetentionCommit = Readonly<{
	id: string;
	commitSeq: bigint;
	kind: 1 | 2 | 3 | 4;
}>;

export function planCrdtGarbageCollection(input: {
	currentManifestId: string;
	previousManifestId: string | null;
	manifests: readonly CrdtRetentionManifest[];
	commits: readonly CrdtRetentionCommit[];
	expiredReceiptIds: readonly string[];
	limit?: number;
}): Readonly<{
	manifestIds: readonly string[];
	commitIds: readonly string[];
	receiptIds: readonly string[];
}> {
	const limit = input.limit ?? DEFAULT_GC_LIMIT;
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > DEFAULT_GC_LIMIT) {
		throw new TypeError("CRDT GC limit must be between 1 and 256");
	}
	const manifests = new Map(
		input.manifests.map((manifest) => [manifest.id, manifest]),
	);
	const current = manifests.get(input.currentManifestId);
	const previous = input.previousManifestId
		? manifests.get(input.previousManifestId)
		: null;
	if (!current || (input.previousManifestId && !previous)) {
		throw new TypeError("CRDT recovery basis is incomplete");
	}
	const manifestIds = input.manifests
		.filter(
			(manifest) =>
				manifest.id !== input.currentManifestId &&
				manifest.id !== input.previousManifestId &&
				!manifest.hasRecentlyRetiredField &&
				!manifest.hasRecoveryHold,
		)
		.map((manifest) => manifest.id);
	const commitIds = previous
		? input.commits
				.filter(
					(commit) =>
						commit.kind === 1 && commit.commitSeq <= previous.coversCommitSeq,
				)
				.map((commit) => commit.id)
		: [];
	const receiptIds = [...input.expiredReceiptIds];
	const selected = {
		manifestIds: [] as string[],
		commitIds: [] as string[],
		receiptIds: [] as string[],
	};
	for (const [source, target] of [
		[manifestIds, selected.manifestIds],
		[commitIds, selected.commitIds],
		[receiptIds, selected.receiptIds],
	] as const) {
		for (const id of source) {
			if (
				selected.manifestIds.length +
					selected.commitIds.length +
					selected.receiptIds.length >=
				limit
			)
				break;
			target.push(id);
		}
	}
	return Object.freeze({
		manifestIds: Object.freeze(selected.manifestIds),
		commitIds: Object.freeze(selected.commitIds),
		receiptIds: Object.freeze(selected.receiptIds),
	});
}

function snapshotCut(cut: CrdtCompactionCut | null): CrdtCompactionCut | null {
	if (!cut) return null;
	if (cut.coversCommitSeq < 0n || cut.leaseGeneration < 1n) {
		throw new TypeError("compaction cut is invalid");
	}
	return Object.freeze({ ...cut });
}
