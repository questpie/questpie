import type { CrdtReplaceReason } from "./types.js";

export type CrdtFieldReplaceInput = Readonly<{
	resourceId: string;
	stableFieldId: string;
	value: string | readonly string[];
	expected: Readonly<{
		fieldEpoch: bigint;
		canonicalRevision: bigint;
	}>;
	reason: CrdtReplaceReason;
}>;

export type CrdtAggregateReplaceInput = Readonly<{
	resourceId: string;
	values: Readonly<Record<string, string | readonly string[]>>;
	expected: Readonly<{
		aggregateEpoch: bigint;
		canonicalRevisions: Readonly<Record<string, bigint>>;
	}>;
	reason: CrdtReplaceReason;
}>;

export type CrdtReplaceResult = Readonly<{
	resourceId: string;
	aggregateEpoch: bigint;
	commitSeq: bigint;
	outboxChanges: 1;
	origin: "crdt_replace";
}>;

export type CrdtReplaceAdapter<TStaged> = Readonly<{
	fieldKeys(resourceId: string): Promise<readonly string[]>;
	stageField(input: CrdtFieldReplaceInput): Promise<TStaged>;
	stageAggregate(input: CrdtAggregateReplaceInput): Promise<TStaged>;
	commitField(
		input: CrdtFieldReplaceInput,
		staged: TStaged,
	): Promise<CrdtReplaceResult>;
	commitAggregate(
		input: CrdtAggregateReplaceInput,
		staged: TStaged,
	): Promise<CrdtReplaceResult>;
}>;

const stagedReplaceProofs = new WeakMap<object, object>();

export function createCrdtReplaceCoordinator<TStaged>(
	adapter: CrdtReplaceAdapter<TStaged>,
) {
	return Object.freeze({
		async replaceField(
			input: CrdtFieldReplaceInput,
		): Promise<CrdtReplaceResult> {
			const candidate = snapshotFieldInput(input);
			const staged = await stage(adapter.stageField(candidate), candidate);
			verifyStaged(staged, candidate);
			return verifyResult(
				candidate.resourceId,
				await adapter.commitField(candidate, staged),
			);
		},
		async replaceAggregate(
			input: CrdtAggregateReplaceInput,
		): Promise<CrdtReplaceResult> {
			const candidate = snapshotAggregateInput(input);
			const fieldKeys = [
				...(await adapter.fieldKeys(candidate.resourceId)),
			].sort();
			const valueKeys = Object.keys(candidate.values).sort();
			const revisionKeys = Object.keys(
				candidate.expected.canonicalRevisions,
			).sort();
			if (
				new Set(fieldKeys).size !== fieldKeys.length ||
				!equalKeys(fieldKeys, valueKeys) ||
				!equalKeys(fieldKeys, revisionKeys)
			) {
				throw new TypeError(
					"aggregate replace requires every collaborative field exactly once",
				);
			}
			const staged = await stage(adapter.stageAggregate(candidate), candidate);
			verifyStaged(staged, candidate);
			return verifyResult(
				candidate.resourceId,
				await adapter.commitAggregate(candidate, staged),
			);
		},
	});
}

function verifyStaged<TStaged>(staged: TStaged, input: object): void {
	if (stagedReplaceProofs.get(staged as object) !== input) {
		throw new TypeError("replace staging capability is invalid");
	}
}

async function stage<TStaged>(
	pending: Promise<TStaged>,
	input: object,
): Promise<TStaged> {
	const staged = await pending;
	if (
		(typeof staged !== "object" && typeof staged !== "function") ||
		staged === null
	) {
		throw new TypeError("replace staging must return an opaque capability");
	}
	stagedReplaceProofs.set(staged, input);
	return staged;
}

function verifyResult(
	resourceId: string,
	result: CrdtReplaceResult,
): CrdtReplaceResult {
	if (
		result.resourceId !== resourceId ||
		result.aggregateEpoch < 0n ||
		result.commitSeq < 1n ||
		result.outboxChanges !== 1 ||
		result.origin !== "crdt_replace"
	) {
		throw new TypeError("replace transaction violated its atomic result");
	}
	return Object.freeze({ ...result });
}

function snapshotFieldInput(
	input: CrdtFieldReplaceInput,
): CrdtFieldReplaceInput {
	validateReason(input.reason);
	if (
		!input.resourceId ||
		!input.stableFieldId ||
		input.expected.fieldEpoch < 0n ||
		input.expected.canonicalRevision < 0n
	) {
		throw new TypeError("field replace input is invalid");
	}
	return Object.freeze({
		...input,
		value: snapshotValue(input.value),
		expected: Object.freeze({ ...input.expected }),
	});
}

function snapshotAggregateInput(
	input: CrdtAggregateReplaceInput,
): CrdtAggregateReplaceInput {
	validateReason(input.reason);
	if (!input.resourceId || input.expected.aggregateEpoch < 0n) {
		throw new TypeError("aggregate replace input is invalid");
	}
	const values = Object.fromEntries(
		Object.entries(input.values).map(([key, value]) => [
			key,
			snapshotValue(value),
		]),
	);
	const canonicalRevisions = Object.fromEntries(
		Object.entries(input.expected.canonicalRevisions).map(([key, revision]) => {
			if (revision < 0n) {
				throw new TypeError("aggregate canonical revision is invalid");
			}
			return [key, revision];
		}),
	);
	return Object.freeze({
		...input,
		values: Object.freeze(values),
		expected: Object.freeze({
			aggregateEpoch: input.expected.aggregateEpoch,
			canonicalRevisions: Object.freeze(canonicalRevisions),
		}),
	});
}

function snapshotValue(
	value: string | readonly string[],
): string | readonly string[] {
	if (typeof value === "string") return value;
	if (
		!Array.isArray(value) ||
		value.some((entry) => typeof entry !== "string")
	) {
		throw new TypeError("replace value is invalid");
	}
	return Object.freeze([...value]);
}

function validateReason(reason: CrdtReplaceReason): void {
	if (!["agent", "import", "restore", "resolve"].includes(reason)) {
		throw new TypeError("replace reason is invalid");
	}
}

function equalKeys(left: readonly string[], right: readonly string[]): boolean {
	return (
		left.length === right.length &&
		left.every((key, index) => key === right[index])
	);
}
