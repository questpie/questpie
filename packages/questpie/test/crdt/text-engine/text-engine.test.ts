import { describe, expect, it } from "bun:test";

import {
	createDeterministicSetEngine,
	createDeterministicTextEngine,
	encodeDeterministicSetUpdate,
	encodeDeterministicTextUpdate,
} from "../../../src/server/modules/core/integrated/crdt/deterministic-engine.js";
import {
	commitCrdtAggregateBundle,
	createCrdtCandidateToken,
	CrdtEngineError,
	stageCrdtAggregateBundle,
} from "../../../src/shared/crdt-engine.js";
import { encodeCrdtFrameV1 } from "../../../src/shared/crdt-protocol.js";

const BASIS = { fieldEpoch: 7n, fieldCursor: 10n };

describe("generic CRDT text engine seam", () => {
	it("stages an atomic sequential operation list without mutating its basis", async () => {
		const engine = createDeterministicTextEngine();
		const replica = await engine.create({ value: "A😀B", basis: BASIS });
		const update = encodeDeterministicTextUpdate([
			{ type: "insert", index: 1, value: "x" },
			{ type: "delete", index: 2, length: 2 },
		]);

		const candidate = await engine.stage({ replica, update });

		expect(engine.project(replica)).toBe("A😀B");
		expect(candidate.projection).toBe("AxB");
		const committed = await engine.commit({
			candidate,
			current: replica,
			assignedFieldCursor: 11n,
		});
		expect(engine.project(committed)).toBe("AxB");
		expect(committed.basis).toEqual({
			fieldEpoch: 7n,
			fieldCursor: 11n,
		});
	});

	it("rejects scalar-boundary, NUL, surrogate, and late-list failures atomically", async () => {
		const engine = createDeterministicTextEngine();
		const replica = await engine.create({ value: "A😀B", basis: BASIS });
		const invalid = [
			[{ type: "insert", index: 2, value: "x" }],
			[{ type: "delete", index: 1, length: 1 }],
			[{ type: "insert", index: 0, value: "\0" }],
			[{ type: "insert", index: 0, value: "\ud800" }],
			[
				{ type: "insert", index: 0, value: "valid-first" },
				{ type: "delete", index: 999, length: 1 },
			],
		] as const;

		for (const operations of invalid) {
			await expect(
				engine.stage({
					replica,
					update: encodeDeterministicTextUpdate(operations),
				}),
			).rejects.toBeInstanceOf(CrdtEngineError);
			expect(engine.project(replica)).toBe("A😀B");
		}
	});

	it("binds a staged token to engine, epoch, cursor, and immutable candidate bytes", async () => {
		const engine = createDeterministicTextEngine();
		const replica = await engine.create({ value: "a", basis: BASIS });
		const candidate = await engine.stage({
			replica,
			update: encodeDeterministicTextUpdate([
				{ type: "insert", index: 1, value: "b" },
			]),
		});

		const stale = await engine.create({
			value: "a",
			basis: { fieldEpoch: 7n, fieldCursor: 11n },
		});
		await expect(
			engine.commit({
				candidate,
				current: stale,
				assignedFieldCursor: 12n,
			}),
		).rejects.toThrow("staged candidate basis");

		const divergent = await engine.create({
			value: "x",
			basis: BASIS,
		});
		await expect(
			engine.commit({
				candidate,
				current: divergent,
				assignedFieldCursor: 11n,
			}),
		).rejects.toThrow("source state");

		candidate.nextSnapshot[0] ^= 0xff;
		await expect(
			engine.commit({
				candidate,
				current: replica,
				assignedFieldCursor: 11n,
			}),
		).rejects.toThrow("staged candidate integrity");
	});

	it("enforces update, operation, and projected-text candidate limits", async () => {
		const engine = createDeterministicTextEngine();
		const replica = await engine.create({ value: "", basis: BASIS });

		await expect(
			engine.stage({
				replica,
				update: encodeDeterministicTextUpdate([
					{ type: "insert", index: 0, value: "abcd" },
				]),
				limits: { maxProjectionBytes: 3 },
			}),
		).rejects.toThrow("projection");
		await expect(
			engine.stage({
				replica,
				update: encodeDeterministicTextUpdate([
					{ type: "insert", index: 0, value: "a" },
					{ type: "insert", index: 1, value: "b" },
				]),
				limits: { maxOperations: 1 },
			}),
		).rejects.toThrow("operation");
		await expect(
			engine.stage({
				replica,
				update: new Uint8Array(8),
				limits: { maxUpdateBytes: 7 },
			}),
		).rejects.toThrow("update");
		await expect(
			engine.stage({
				replica,
				update: encodeDeterministicTextUpdate([]),
				limits: { maxUpdateBytes: 256 * 1024 + 1 },
			}),
		).rejects.toThrow("hard engine limit");
	});

	it("produces deterministic proof, diff, snapshot, restore, and projection", async () => {
		const engine = createDeterministicTextEngine();
		const replica = await engine.create({ value: "hello 😀", basis: BASIS });
		const proof = await engine.proof(replica);
		const snapshot = await engine.snapshot(replica);

		expect(await engine.diff({ replica, proof })).toEqual({
			kind: "current",
		});
		const differentProof = new Uint8Array(proof);
		differentProof[0] ^= 0xff;
		expect(await engine.diff({ replica, proof: differentProof })).toEqual({
			kind: "snapshot",
			snapshot,
		});
		expect(await engine.snapshot(replica)).toEqual(snapshot);

		const restored = await engine.restore({
			snapshot,
			basis: { fieldEpoch: 8n, fieldCursor: 0n },
		});
		expect(engine.project(restored)).toBe("hello 😀");
		expect(restored.basis).toEqual({
			fieldEpoch: 8n,
			fieldCursor: 0n,
		});
	});
});

describe("aggregate coordinator and deterministic add-wins set", () => {
	it("commits title, tags, and content as one sorted aggregate candidate", async () => {
		const text = createDeterministicTextEngine();
		const set = createDeterministicSetEngine();
		const title = await text.create({ value: "", basis: BASIS });
		const tags = await set.create({ value: [], basis: BASIS });
		const content = await text.create({ value: "", basis: BASIS });

		const staged = await stageCrdtAggregateBundle({
			aggregateEpoch: 3n,
			submittedSchemaVersion: 9,
			canonicalSchemaVersion: 9,
			parts: [
				{
					fieldSlot: 1,
					engine: text,
					replica: title,
					update: encodeDeterministicTextUpdate([
						{ type: "insert", index: 0, value: "Shared title" },
					]),
				},
				{
					fieldSlot: 2,
					engine: set,
					replica: tags,
					update: encodeDeterministicSetUpdate([
						{ type: "add", value: "news", dot: "writer-a:1" },
					]),
				},
				{
					fieldSlot: 3,
					engine: text,
					replica: content,
					update: encodeDeterministicTextUpdate([
						{ type: "insert", index: 0, value: "Body" },
					]),
				},
			],
		});

		expect(staged.parts.map((part) => part.fieldSlot)).toEqual([1, 2, 3]);
		expect(staged.submittedDigest).toHaveLength(32);
		expect(staged.canonicalDigest).toHaveLength(32);
		const frame = encodeCrdtFrameV1({
			major: 1,
			minor: 0,
			opcode: 0x04,
			connectionSeq: 1n,
			requestId: 1n,
			payload: {
				updateId: new Uint8Array(16),
				aggregateEpoch: 3n,
				schemaVersion: 9,
				parts: staged.parts.map((part) => ({
					fieldSlot: part.fieldSlot,
					fieldEpoch: part.candidate.basis.fieldEpoch,
					formatVersion: part.candidate.formatVersion,
					baseFieldCursor: part.candidate.basis.fieldCursor,
					bytes: part.submittedUpdate,
				})),
			},
		});
		const submittedPayload = new Uint8Array(frame.byteLength - 48);
		submittedPayload.set(frame.subarray(48));
		expect(staged.submittedDigest).toEqual(
			new Uint8Array(
				await crypto.subtle.digest("SHA-256", submittedPayload.buffer),
			),
		);
		const committed = await commitCrdtAggregateBundle({
			staged,
			current: new Map([
				[1, title],
				[2, tags],
				[3, content],
			]),
			assignedFieldCursors: new Map([
				[1, 11n],
				[2, 11n],
				[3, 11n],
			]),
		});
		expect(text.project(committed.get(1)!)).toBe("Shared title");
		expect(set.project(committed.get(2)!)).toEqual(["news"]);
		expect(text.project(committed.get(3)!)).toBe("Body");

		staged.submittedDigest[0] ^= 0xff;
		await expect(
			commitCrdtAggregateBundle({
				staged,
				current: new Map([
					[1, title],
					[2, tags],
					[3, content],
				]),
				assignedFieldCursors: new Map([
					[1, 11n],
					[2, 11n],
					[3, 11n],
				]),
			}),
		).rejects.toThrow("staged aggregate result integrity");
	});

	it("rejects coherent staged-result tampering even with a recomputed public token", async () => {
		const text = createDeterministicTextEngine();
		const replica = await text.create({ value: "", basis: BASIS });
		const staged = await stageCrdtAggregateBundle({
			aggregateEpoch: 3n,
			submittedSchemaVersion: 9,
			canonicalSchemaVersion: 9,
			parts: [
				{
					fieldSlot: 1,
					engine: text,
					replica,
					update: encodeDeterministicTextUpdate([
						{ type: "insert", index: 0, value: "x" },
					]),
				},
			],
		});
		const candidate = staged.parts[0]!.candidate;
		candidate.nextSnapshot[candidate.nextSnapshot.byteLength - 1] ^= 1;
		candidate.token.set(await createCrdtCandidateToken(candidate));

		await expect(
			commitCrdtAggregateBundle({
				staged,
				current: new Map([[1, replica]]),
				assignedFieldCursors: new Map([[1, 11n]]),
			}),
		).rejects.toThrow("staged aggregate result integrity");
	});

	it("owns a defensive candidate copy after an engine returns from staging", async () => {
		const text = createDeterministicTextEngine();
		const replica = await text.create({ value: "", basis: BASIS });
		let retained: Awaited<ReturnType<typeof text.stage>> | undefined;
		const retainingEngine = {
			...text,
			stage: async (input: Parameters<typeof text.stage>[0]) => {
				retained = await text.stage(input);
				return retained;
			},
		};
		const staged = await stageCrdtAggregateBundle({
			aggregateEpoch: 3n,
			submittedSchemaVersion: 9,
			canonicalSchemaVersion: 9,
			parts: [
				{
					fieldSlot: 1,
					engine: retainingEngine,
					replica,
					update: encodeDeterministicTextUpdate([
						{ type: "insert", index: 0, value: "owned" },
					]),
				},
			],
		});
		retained!.nextSnapshot[retained!.nextSnapshot.byteLength - 1] ^= 1;
		retained!.token.set(await createCrdtCandidateToken(retained!));

		const committed = await commitCrdtAggregateBundle({
			staged,
			current: new Map([[1, replica]]),
			assignedFieldCursors: new Map([[1, 11n]]),
		});
		expect(text.project(committed.get(1)!)).toBe("owned");
	});

	it("snapshots caller-owned update bytes before staging yields", async () => {
		const text = createDeterministicTextEngine();
		const replica = await text.create({ value: "", basis: BASIS });
		const update = encodeDeterministicTextUpdate([
			{ type: "insert", index: 0, value: "owned" },
		]);
		const staging = stageCrdtAggregateBundle({
			aggregateEpoch: 3n,
			submittedSchemaVersion: 9,
			canonicalSchemaVersion: 9,
			parts: [{ fieldSlot: 1, engine: text, replica, update }],
		});
		update[update.byteLength - 1] ^= 1;
		const staged = await staging;

		const committed = await commitCrdtAggregateBundle({
			staged,
			current: new Map([[1, replica]]),
			assignedFieldCursors: new Map([[1, 11n]]),
		});
		expect(text.project(committed.get(1)!)).toBe("owned");
	});

	it("snapshots aggregate metadata, slots, and engines before staging yields", async () => {
		const text = createDeterministicTextEngine();
		const first = await text.create({ value: "", basis: BASIS });
		const second = await text.create({ value: "", basis: BASIS });
		const replacementEngine = {
			...text,
			stage: async () => {
				throw new Error("replacement engine must not run");
			},
		};
		const request = {
			aggregateEpoch: 3n,
			submittedSchemaVersion: 9,
			canonicalSchemaVersion: 9,
			parts: [
				{
					fieldSlot: 1,
					engine: text,
					replica: first,
					update: encodeDeterministicTextUpdate([
						{ type: "insert" as const, index: 0, value: "first" },
					]),
				},
				{
					fieldSlot: 2,
					engine: text,
					replica: second,
					update: encodeDeterministicTextUpdate([
						{ type: "insert" as const, index: 0, value: "second" },
					]),
				},
			],
		};
		const staging = stageCrdtAggregateBundle(request);
		request.aggregateEpoch = 4n;
		request.submittedSchemaVersion = 10;
		request.canonicalSchemaVersion = 10;
		request.parts[1]!.fieldSlot = 1;
		request.parts[1]!.engine = replacementEngine;
		const staged = await staging;

		expect(staged.aggregateEpoch).toBe(3n);
		expect(staged.submittedSchemaVersion).toBe(9);
		expect(staged.canonicalSchemaVersion).toBe(9);
		expect(staged.parts.map((part) => part.fieldSlot)).toEqual([1, 2]);
		const committed = await commitCrdtAggregateBundle({
			staged,
			current: new Map([
				[1, first],
				[2, second],
			]),
			assignedFieldCursors: new Map([
				[1, 11n],
				[2, 11n],
			]),
		});
		expect(text.project(committed.get(1)!)).toBe("first");
		expect(text.project(committed.get(2)!)).toBe("second");
	});

	it("owns a defensive replica copy immediately after an engine commit returns", async () => {
		const text = createDeterministicTextEngine();
		const replica = await text.create({ value: "", basis: BASIS });
		let resolveMutation!: () => void;
		const mutated = new Promise<void>((resolve) => {
			resolveMutation = resolve;
		});
		const retainingEngine = {
			...text,
			commit: async (input: Parameters<typeof text.commit>[0]) => {
				const committed = await text.commit(input);
				setTimeout(() => {
					committed.state[committed.state.byteLength - 1] ^= 1;
					resolveMutation();
				}, 0);
				return committed;
			},
		};
		const staged = await stageCrdtAggregateBundle({
			aggregateEpoch: 3n,
			submittedSchemaVersion: 9,
			canonicalSchemaVersion: 9,
			parts: [
				{
					fieldSlot: 1,
					engine: retainingEngine,
					replica,
					update: encodeDeterministicTextUpdate([
						{ type: "insert", index: 0, value: "owned" },
					]),
				},
			],
		});

		const committed = await commitCrdtAggregateBundle({
			staged,
			current: new Map([[1, replica]]),
			assignedFieldCursors: new Map([[1, 11n]]),
		});
		await mutated;
		expect(text.project(committed.get(1)!)).toBe("owned");
	});

	it("is all-or-nothing for invalid or unsorted aggregate parts", async () => {
		const text = createDeterministicTextEngine();
		const title = await text.create({ value: "", basis: BASIS });
		const content = await text.create({ value: "", basis: BASIS });

		await expect(
			stageCrdtAggregateBundle({
				aggregateEpoch: 3n,
				submittedSchemaVersion: 9,
				canonicalSchemaVersion: 9,
				parts: [
					{
						fieldSlot: 2,
						engine: text,
						replica: content,
						update: encodeDeterministicTextUpdate([]),
					},
					{
						fieldSlot: 1,
						engine: text,
						replica: title,
						update: encodeDeterministicTextUpdate([]),
					},
				],
			}),
		).rejects.toThrow("strictly increasing");
		await expect(
			stageCrdtAggregateBundle({
				aggregateEpoch: 3n,
				submittedSchemaVersion: 9,
				canonicalSchemaVersion: 9,
				maxBundleBytes: 2,
				parts: [
					{
						fieldSlot: 1,
						engine: text,
						replica: title,
						update: encodeDeterministicTextUpdate([]),
					},
				],
			}),
		).rejects.toThrow("bundle");
		await expect(
			stageCrdtAggregateBundle({
				aggregateEpoch: 3n,
				submittedSchemaVersion: 9,
				canonicalSchemaVersion: 9,
				parts: [
					{
						fieldSlot: 1,
						engine: text,
						replica: title,
						update: encodeDeterministicTextUpdate([
							{ type: "insert", index: 0, value: "valid" },
						]),
					},
					{
						fieldSlot: 2,
						engine: text,
						replica: content,
						update: encodeDeterministicTextUpdate([
							{ type: "insert", index: 99, value: "invalid" },
						]),
					},
				],
			}),
		).rejects.toBeInstanceOf(CrdtEngineError);
		expect(text.project(title)).toBe("");
		expect(text.project(content)).toBe("");
	});

	it("hashes submitted and normalized schemas with their own field metadata", async () => {
		const text = createDeterministicTextEngine();
		const replica = await text.create({ value: "", basis: BASIS });
		const update = encodeDeterministicTextUpdate([
			{ type: "insert", index: 0, value: "compatible" },
		]);
		const staged = await stageCrdtAggregateBundle({
			aggregateEpoch: 3n,
			submittedSchemaVersion: 8,
			canonicalSchemaVersion: 9,
			parts: [
				{
					fieldSlot: 1,
					submitted: {
						fieldSlot: 7,
						fieldEpoch: 4n,
						formatVersion: 2,
						baseFieldCursor: 3n,
					},
					engine: text,
					replica,
					update,
				},
			],
		});
		const submittedFrame = encodeCrdtFrameV1({
			major: 1,
			minor: 0,
			opcode: 0x04,
			connectionSeq: 1n,
			requestId: 1n,
			payload: {
				updateId: new Uint8Array(16),
				aggregateEpoch: 3n,
				schemaVersion: 8,
				parts: [
					{
						fieldSlot: 7,
						fieldEpoch: 4n,
						formatVersion: 2,
						baseFieldCursor: 3n,
						bytes: update,
					},
				],
			},
		});
		const canonicalFrame = encodeCrdtFrameV1({
			major: 1,
			minor: 0,
			opcode: 0x04,
			connectionSeq: 1n,
			requestId: 1n,
			payload: {
				updateId: new Uint8Array(16),
				aggregateEpoch: 3n,
				schemaVersion: 9,
				parts: [
					{
						fieldSlot: 1,
						fieldEpoch: 7n,
						formatVersion: 1,
						baseFieldCursor: 10n,
						bytes: update,
					},
				],
			},
		});

		expect(staged.submittedDigest).toEqual(
			await updatePayloadDigest(submittedFrame),
		);
		expect(staged.canonicalDigest).toEqual(
			await updatePayloadDigest(canonicalFrame),
		);
		expect(staged.submittedDigest).not.toEqual(staged.canonicalDigest);
	});

	it("keeps an unobserved concurrent add and removes only observed dots", async () => {
		const set = createDeterministicSetEngine();
		const empty = await set.create({ value: [], basis: BASIS });
		const addA = encodeDeterministicSetUpdate([
			{ type: "add", value: "news", dot: "writer-a:1" },
		]);
		const afterA = await set.commit({
			candidate: await set.stage({ replica: empty, update: addA }),
			current: empty,
			assignedFieldCursor: 11n,
		});
		const removeObservedA = encodeDeterministicSetUpdate([
			{
				type: "delete",
				value: "news",
				observedDots: ["writer-a:1"],
			},
		]);
		const addB = encodeDeterministicSetUpdate([
			{ type: "add", value: "news", dot: "writer-b:1" },
		]);

		const removedFirst = await set.commit({
			candidate: await set.stage({
				replica: afterA,
				update: removeObservedA,
			}),
			current: afterA,
			assignedFieldCursor: 12n,
		});
		expect(set.project(removedFirst)).toEqual([]);
		const addAfterRemove = await set.commit({
			candidate: await set.stage({
				replica: removedFirst,
				update: addB,
			}),
			current: removedFirst,
			assignedFieldCursor: 13n,
		});

		const addedFirst = await set.commit({
			candidate: await set.stage({ replica: afterA, update: addB }),
			current: afterA,
			assignedFieldCursor: 12n,
		});
		const removeAfterAdd = await set.commit({
			candidate: await set.stage({
				replica: addedFirst,
				update: removeObservedA,
			}),
			current: addedFirst,
			assignedFieldCursor: 13n,
		});

		expect(set.project(addAfterRemove)).toEqual(["news"]);
		expect(set.project(removeAfterAdd)).toEqual(["news"]);
	});

	it("keeps tombstones across remove-before-add and projects UTF-8 order", async () => {
		const set = createDeterministicSetEngine();
		const base = await set.create({
			value: ["ä", "z", "a"],
			basis: BASIS,
		});
		expect(set.project(base)).toEqual(["a", "z", "ä"]);

		const removedBeforeAdd = await set.commit({
			candidate: await set.stage({
				replica: base,
				update: encodeDeterministicSetUpdate([
					{
						type: "delete",
						value: "later",
						observedDots: ["writer-a:9"],
					},
				]),
			}),
			current: base,
			assignedFieldCursor: 11n,
		});
		const lateAdd = await set.commit({
			candidate: await set.stage({
				replica: removedBeforeAdd,
				update: encodeDeterministicSetUpdate([
					{ type: "add", value: "later", dot: "writer-a:9" },
				]),
			}),
			current: removedBeforeAdd,
			assignedFieldCursor: 12n,
		});
		expect(set.project(lateAdd)).toEqual(["a", "z", "ä"]);

		const snapshot = await set.snapshot(lateAdd);
		const restored = await set.restore({
			snapshot,
			basis: { fieldEpoch: 8n, fieldCursor: 0n },
		});
		expect(set.project(restored)).toEqual(["a", "z", "ä"]);
		expect(await set.proof(restored)).toEqual(await set.proof(lateAdd));
	});

	it("rejects cross-element dot reuse in either delivery order", async () => {
		const set = createDeterministicSetEngine();
		const base = await set.create({ value: [], basis: BASIS });
		const removeX = encodeDeterministicSetUpdate([
			{ type: "delete", value: "x", observedDots: ["writer-a:1"] },
		]);
		const addY = encodeDeterministicSetUpdate([
			{ type: "add", value: "y", dot: "writer-a:1" },
		]);

		const removedFirst = await set.commit({
			candidate: await set.stage({ replica: base, update: removeX }),
			current: base,
			assignedFieldCursor: 11n,
		});
		await expect(
			set.stage({ replica: removedFirst, update: addY }),
		).rejects.toThrow("another element");

		const addedFirst = await set.commit({
			candidate: await set.stage({ replica: base, update: addY }),
			current: base,
			assignedFieldCursor: 11n,
		});
		await expect(
			set.stage({ replica: addedFirst, update: removeX }),
		).rejects.toThrow("another element");
	});

	it("rejects duplicate and malformed set elements atomically", async () => {
		const set = createDeterministicSetEngine();
		await expect(
			set.create({ value: ["same", "same"], basis: BASIS }),
		).rejects.toThrow("duplicate");
		const replica = await set.create({ value: [], basis: BASIS });
		for (const value of ["", "\0", "\ud800", "x".repeat(4097)]) {
			await expect(
				set.stage({
					replica,
					update: encodeDeterministicSetUpdate([
						{ type: "add", value, dot: "writer-a:1" },
					]),
				}),
			).rejects.toBeInstanceOf(CrdtEngineError);
			expect(set.project(replica)).toEqual([]);
		}
	});

	it("rejects oversized and cumulatively unbounded snapshots before full materialization", async () => {
		const text = createDeterministicTextEngine();
		await expect(
			text.restore({
				snapshot: new Uint8Array(24 * 1024 * 1024 + 1),
				basis: BASIS,
			}),
		).rejects.toThrow("snapshot");

		const set = createDeterministicSetEngine();
		await expect(
			set.restore({
				snapshot: cumulativeDotOverflowSnapshot(),
				basis: BASIS,
			}),
		).rejects.toThrow("dot count");
	});

	it("rejects engines that mutate inputs or return the wrong committed basis", async () => {
		const text = createDeterministicTextEngine();
		const replica = await text.create({ value: "", basis: BASIS });
		const update = encodeDeterministicTextUpdate([
			{ type: "insert", index: 0, value: "x" },
		]);
		const impureStage = {
			...text,
			stage: async (input: Parameters<typeof text.stage>[0]) => {
				const candidate = await text.stage(input);
				input.replica.state[0] ^= 0xff;
				return candidate;
			},
		};
		await expect(
			stageCrdtAggregateBundle({
				aggregateEpoch: 1n,
				submittedSchemaVersion: 1,
				canonicalSchemaVersion: 1,
				parts: [
					{
						fieldSlot: 1,
						engine: impureStage,
						replica,
						update,
					},
				],
			}),
		).rejects.toThrow("mutated its source replica");
		expect(text.project(replica)).toBe("");

		const mutateThenThrowStage = {
			...text,
			stage: async (input: Parameters<typeof text.stage>[0]) => {
				input.replica.state[0] ^= 0xff;
				throw new Error("stage adapter failed");
			},
		};
		await expect(
			stageCrdtAggregateBundle({
				aggregateEpoch: 1n,
				submittedSchemaVersion: 1,
				canonicalSchemaVersion: 1,
				parts: [
					{
						fieldSlot: 1,
						engine: mutateThenThrowStage,
						replica,
						update,
					},
				],
			}),
		).rejects.toThrow("stage adapter failed");
		expect(text.project(replica)).toBe("");

		const clean = await text.create({ value: "", basis: BASIS });
		const cleanSecond = await text.create({ value: "", basis: BASIS });
		const mutateThenThrowCommit = {
			...text,
			commit: async (input: Parameters<typeof text.commit>[0]) => {
				input.current.state[0] ^= 0xff;
				input.candidate.nextSnapshot[0] ^= 0xff;
				throw new Error("commit adapter failed");
			},
		};
		const rejectedCommit = await stageCrdtAggregateBundle({
			aggregateEpoch: 1n,
			submittedSchemaVersion: 1,
			canonicalSchemaVersion: 1,
			parts: [
				{
					fieldSlot: 1,
					engine: mutateThenThrowCommit,
					replica: clean,
					update,
				},
				{
					fieldSlot: 2,
					engine: mutateThenThrowCommit,
					replica: cleanSecond,
					update,
				},
			],
		});
		await expect(
			commitCrdtAggregateBundle({
				staged: rejectedCommit,
				current: new Map([
					[1, clean],
					[2, cleanSecond],
				]),
				assignedFieldCursors: new Map([
					[1, 11n],
					[2, 11n],
				]),
			}),
		).rejects.toThrow("commit adapter failed");
		expect(text.project(clean)).toBe("");
		expect(text.project(cleanSecond)).toBe("");

		const invalidCommit = {
			...text,
			commit: async (input: Parameters<typeof text.commit>[0]) => {
				const committed = await text.commit(input);
				return {
					...committed,
					basis: {
						fieldEpoch: committed.basis.fieldEpoch,
						fieldCursor: 99n,
					},
				};
			},
		};
		const staged = await stageCrdtAggregateBundle({
			aggregateEpoch: 1n,
			submittedSchemaVersion: 1,
			canonicalSchemaVersion: 1,
			parts: [
				{
					fieldSlot: 1,
					engine: invalidCommit,
					replica: clean,
					update,
				},
			],
		});
		await expect(
			commitCrdtAggregateBundle({
				staged,
				current: new Map([[1, clean]]),
				assignedFieldCursors: new Map([[1, 11n]]),
			}),
		).rejects.toThrow("invalid committed replica");
	});
});

function cumulativeDotOverflowSnapshot(): Uint8Array {
	const firstDots = 50_001;
	const dotBytes = 9;
	const size = 4 + (4 + 2 + 4 + firstDots * (2 + dotBytes)) + (4 + 2 + 4);
	const bytes = new Uint8Array(size);
	const view = new DataView(bytes.buffer);
	let offset = 0;
	const u16 = (value: number) => {
		view.setUint16(offset, value);
		offset += 2;
	};
	const u32 = (value: number) => {
		view.setUint32(offset, value);
		offset += 4;
	};
	const utf16 = (value: string) => {
		u32(value.length);
		for (const character of value) u16(character.charCodeAt(0));
	};
	const ascii = (value: string) => {
		u16(value.length);
		for (const character of value) {
			bytes[offset++] = character.charCodeAt(0);
		}
	};

	u32(2);
	utf16("x");
	u32(firstDots);
	for (let index = 0; index < firstDots; index++) {
		ascii(`d${index.toString(16).padStart(6, "0")}:1`);
	}
	utf16("y");
	u32(50_000);
	return bytes;
}

async function updatePayloadDigest(frame: Uint8Array): Promise<Uint8Array> {
	const payloadAfterUpdateId = new Uint8Array(frame.byteLength - 48);
	payloadAfterUpdateId.set(frame.subarray(48));
	return new Uint8Array(
		await crypto.subtle.digest("SHA-256", payloadAfterUpdateId.buffer),
	);
}
