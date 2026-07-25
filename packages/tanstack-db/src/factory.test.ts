import { describe, expect, it } from "bun:test";

import { QueryClient } from "@tanstack/react-query";
import { collection } from "questpie";
import type { QuestpieClient } from "questpie/client";

import { createQuestpieCollections } from "./factory.js";
import { resolveSync } from "./sync.js";

type Row = { id: string; title: string };

const posts = collection("posts").fields(({ f }) => ({
	title: f.text(255).required(),
}));

type App = { collections: { posts: typeof posts } };

function envelope(docs: Row[]) {
	return {
		docs,
		totalDocs: docs.length,
		totalPages: 1,
		page: 1,
		hasNextPage: false,
		hasPrevPage: false,
		nextPage: null,
		prevPage: null,
	};
}

function createFakeClient(initial: Row[]) {
	let rows = initial;
	let failFind = false;
	let failUpdate = false;
	let heldCreate:
		| {
				started: () => void;
				wait: Promise<void>;
		  }
		| undefined;
	let heldUpdate:
		| {
				started: () => void;
				wait: Promise<void>;
		  }
		| undefined;
	let heldDelete:
		| {
				started: () => void;
				wait: Promise<void>;
		  }
		| undefined;
	let liveListener: ((value: ReturnType<typeof envelope>) => void) | undefined;
	const calls = { find: 0, create: 0, update: 0, delete: 0 };

	const api = {
		find: async () => {
			calls.find += 1;
			if (failFind) {
				failFind = false;
				throw new Error("snapshot refresh rejected");
			}
			return envelope(rows);
		},
		create: async (row: Row) => {
			calls.create += 1;
			rows = [...rows, row];
			const held = heldCreate;
			heldCreate = undefined;
			held?.started();
			await held?.wait;
			return row;
		},
		update: async ({ id, data }: { id: string; data: Partial<Row> }) => {
			calls.update += 1;
			if (failUpdate) throw new Error("update rejected");
			rows = rows.map((row) => (row.id === id ? { ...row, ...data } : row));
			const result = rows.find((row) => row.id === id)!;
			const held = heldUpdate;
			heldUpdate = undefined;
			held?.started();
			await held?.wait;
			return result;
		},
		delete: async ({ id }: { id: string }) => {
			calls.delete += 1;
			rows = rows.filter((row) => row.id !== id);
			const held = heldDelete;
			heldDelete = undefined;
			held?.started();
			await held?.wait;
			return { success: true };
		},
		live: (
			_options: unknown,
			listener: (value: ReturnType<typeof envelope>) => void,
		) => {
			liveListener = listener;
			queueMicrotask(() => listener(envelope(rows)));
			return () => {
				if (liveListener === listener) liveListener = undefined;
			};
		},
	};

	return {
		client: { collections: { posts: api } } as unknown as QuestpieClient<App>,
		calls,
		failNextFind() {
			failFind = true;
		},
		failNextUpdate() {
			failUpdate = true;
		},
		holdNextCreate() {
			let markStarted = () => {};
			const started = new Promise<void>((resolve) => {
				markStarted = resolve;
			});
			let release = () => {};
			const wait = new Promise<void>((resolve) => {
				release = resolve;
			});
			heldCreate = { started: markStarted, wait };
			return { started, release };
		},
		holdNextUpdate() {
			let markStarted = () => {};
			const started = new Promise<void>((resolve) => {
				markStarted = resolve;
			});
			let release = () => {};
			const wait = new Promise<void>((resolve) => {
				release = resolve;
			});
			heldUpdate = { started: markStarted, wait };
			return { started, release };
		},
		holdNextDelete() {
			let markStarted = () => {};
			const started = new Promise<void>((resolve) => {
				markStarted = resolve;
			});
			let release = () => {};
			const wait = new Promise<void>((resolve) => {
				release = resolve;
			});
			heldDelete = { started: markStarted, wait };
			return { started, release };
		},
		emit(next: Row[]) {
			rows = next;
			liveListener?.(envelope(rows));
		},
		emitSnapshot(next: Row[]) {
			liveListener?.(envelope(next));
		},
	};
}

describe("createQuestpieCollections", () => {
	it("retries snapshot subscription after a transient initial error", async () => {
		const queryClient = new QueryClient();
		let liveCalls = 0;
		let activeSubscriptions = 0;
		const sync = resolveSync<Row>({
			client: {
				find: async () => envelope([]),
				live: (_options, onSnapshot, options) => {
					liveCalls += 1;
					activeSubscriptions += 1;
					if (liveCalls === 1) {
						queueMicrotask(() => options?.onError?.(new Error("temporary")));
					} else {
						queueMicrotask(() =>
							onSnapshot(envelope([{ id: "one", title: "Recovered" }])),
						);
					}
					let disposed = false;
					return () => {
						if (disposed) return;
						disposed = true;
						activeSubscriptions -= 1;
					};
				},
			},
			mode: "snapshot",
			queryClient,
			queryKey: ["posts"],
			onDispose: () => {},
		});

		await expect(sync.queryFn()).rejects.toThrow("temporary");
		expect(activeSubscriptions).toBe(0);
		await expect(sync.queryFn()).resolves.toEqual([
			{ id: "one", title: "Recovered" },
		]);
		expect(liveCalls).toBe(2);
		expect(activeSubscriptions).toBe(1);
	});

	it("pins the tested TanStack DB package tuple exactly", async () => {
		const manifest = (await Bun.file(
			new URL("../package.json", import.meta.url),
		).json()) as {
			peerDependencies: Record<string, string>;
			exports: Record<string, unknown>;
			publishConfig: { exports: Record<string, unknown> };
		};

		expect(manifest.peerDependencies).toMatchObject({
			"@tanstack/db": "0.6.16",
			"@tanstack/query-db-collection": "1.1.0",
			"@tanstack/react-db": "0.1.94",
		});
		expect(manifest.exports).not.toHaveProperty("./*");
		expect(manifest.publishConfig.exports).not.toHaveProperty("./*");
		expect(manifest.publishConfig.exports["."]).toBeDefined();
	});

	it("caches one collection per name and persists through refetch mode", async () => {
		const fake = createFakeClient([{ id: "one", title: "Before" }]);
		const db = createQuestpieCollections(fake.client, {
			queryClient: new QueryClient(),
		});

		expect(db.collections.posts).toBe(db.collections.posts);
		await db.collections.posts.preload();
		expect(db.collections.posts.get("one")?.title).toBe("Before");

		const transaction = db.collections.posts.update("one", (draft) => {
			draft.title = "After";
		});
		expect(db.collections.posts.get("one")?.title).toBe("After");
		await transaction.isPersisted.promise;

		expect(fake.calls.update).toBe(1);
		expect(fake.calls.find).toBeGreaterThanOrEqual(2);
		expect(db.collections.posts.get("one")?.title).toBe("After");
		db.destroy();
	});

	it("rolls back an optimistic update when QUESTPIE rejects it", async () => {
		const fake = createFakeClient([{ id: "one", title: "Before" }]);
		const db = createQuestpieCollections(fake.client, {
			queryClient: new QueryClient(),
		});
		await db.collections.posts.preload();
		fake.failNextUpdate();

		const transaction = db.collections.posts.update("one", (draft) => {
			draft.title = "Rejected";
		});
		expect(db.collections.posts.get("one")?.title).toBe("Rejected");
		await expect(transaction.isPersisted.promise).rejects.toThrow(
			"update rejected",
		);
		expect(db.collections.posts.get("one")?.title).toBe("Before");
		db.destroy();
	});

	it("replaces store rows from full snapshots", async () => {
		const fake = createFakeClient([{ id: "one", title: "Before" }]);
		const db = createQuestpieCollections(fake.client, {
			queryClient: new QueryClient(),
			syncMode: "snapshot",
		});
		await db.collections.posts.preload();

		fake.emit([{ id: "two", title: "Replacement" }]);
		await Promise.resolve();

		expect(db.collections.posts.has("one")).toBe(false);
		expect(db.collections.posts.get("two")?.title).toBe("Replacement");
		db.destroy();
	});

	it("keeps a successful optimistic mutation in snapshot mode", async () => {
		const fake = createFakeClient([{ id: "one", title: "Before" }]);
		const db = createQuestpieCollections(fake.client, {
			queryClient: new QueryClient(),
			syncMode: "snapshot",
		});
		await db.collections.posts.preload();

		const transaction = db.collections.posts.update("one", (draft) => {
			draft.title = "Persisted";
		});
		expect(db.collections.posts.get("one")?.title).toBe("Persisted");
		await transaction.isPersisted.promise;
		expect(db.collections.posts.get("one")?.title).toBe("Persisted");
		db.destroy();
	});

	it("does not overwrite a newer snapshot with a delayed mutation response", async () => {
		const fake = createFakeClient([{ id: "one", title: "Before" }]);
		const db = createQuestpieCollections(fake.client, {
			queryClient: new QueryClient(),
			syncMode: "snapshot",
		});
		await db.collections.posts.preload();
		const held = fake.holdNextUpdate();

		const transaction = db.collections.posts.update("one", (draft) => {
			draft.title = "Delayed response";
		});
		await held.started;
		fake.emit([{ id: "one", title: "Newer snapshot" }]);
		held.release();
		await transaction.isPersisted.promise;

		expect(db.collections.posts.get("one")?.title).toBe("Newer snapshot");
		db.destroy();
	});

	it("reconciles a persisted update after a stale snapshot arrives mid-flight", async () => {
		const fake = createFakeClient([{ id: "one", title: "Before" }]);
		const db = createQuestpieCollections(fake.client, {
			queryClient: new QueryClient(),
			syncMode: "snapshot",
		});
		await db.collections.posts.preload();
		const held = fake.holdNextUpdate();

		const transaction = db.collections.posts.update("one", (draft) => {
			draft.title = "Persisted";
		});
		await held.started;
		fake.emitSnapshot([{ id: "one", title: "Before" }]);
		held.release();
		await transaction.isPersisted.promise;

		expect(db.collections.posts.get("one")?.title).toBe("Persisted");
		db.destroy();
	});

	it("keeps a committed update when its reconciliation read fails", async () => {
		const fake = createFakeClient([{ id: "one", title: "Before" }]);
		const db = createQuestpieCollections(fake.client, {
			queryClient: new QueryClient(),
			syncMode: "snapshot",
		});
		await db.collections.posts.preload();
		const held = fake.holdNextUpdate();

		const transaction = db.collections.posts.update("one", (draft) => {
			draft.title = "Persisted";
		});
		await held.started;
		fake.emitSnapshot([{ id: "one", title: "Before" }]);
		fake.failNextFind();
		held.release();

		await transaction.isPersisted.promise;
		expect(db.collections.posts.get("one")?.title).toBe("Persisted");
		db.destroy();
	});

	it("preserves a newer live value when its reconciliation read fails", async () => {
		const fake = createFakeClient([{ id: "one", title: "Before" }]);
		const db = createQuestpieCollections(fake.client, {
			queryClient: new QueryClient(),
			syncMode: "snapshot",
		});
		await db.collections.posts.preload();
		const held = fake.holdNextUpdate();

		const transaction = db.collections.posts.update("one", (draft) => {
			draft.title = "Delayed response";
		});
		await held.started;
		fake.emit([{ id: "one", title: "Newer snapshot" }]);
		fake.failNextFind();
		held.release();
		await transaction.isPersisted.promise;

		expect(db.collections.posts.get("one")?.title).toBe("Newer snapshot");
		db.destroy();
	});

	it("keeps a committed insert when its reconciliation read fails", async () => {
		const fake = createFakeClient([{ id: "one", title: "Before" }]);
		const db = createQuestpieCollections(fake.client, {
			queryClient: new QueryClient(),
			syncMode: "snapshot",
		});
		await db.collections.posts.preload();
		const held = fake.holdNextCreate();

		const now = new Date();
		const transaction = db.collections.posts.insert({
			id: "two",
			_title: "Persisted",
			createdAt: now,
			updatedAt: now,
			title: "Persisted",
		});
		await held.started;
		fake.emitSnapshot([{ id: "one", title: "Before" }]);
		fake.failNextFind();
		held.release();
		await transaction.isPersisted.promise;

		expect(db.collections.posts.get("two")?.title).toBe("Persisted");
		db.destroy();
	});

	it("keeps a committed delete when its reconciliation read fails", async () => {
		const fake = createFakeClient([{ id: "one", title: "Before" }]);
		const db = createQuestpieCollections(fake.client, {
			queryClient: new QueryClient(),
			syncMode: "snapshot",
		});
		await db.collections.posts.preload();
		const held = fake.holdNextDelete();

		const transaction = db.collections.posts.delete("one");
		await held.started;
		fake.emitSnapshot([{ id: "one", title: "Before" }]);
		fake.failNextFind();
		held.release();
		await transaction.isPersisted.promise;

		expect(db.collections.posts.has("one")).toBe(false);
		db.destroy();
	});

	it("rejects runtime find options that can remove ids or change row shape", () => {
		const fake = createFakeClient([{ id: "one", title: "Before" }]);
		const db = createQuestpieCollections(fake.client, {
			queryClient: new QueryClient(),
			find: { posts: { columns: { title: true } } } as never,
		});

		expect(() => db.collections.posts).toThrow("find.columns is not supported");
		db.destroy();
	});

	it("does not share collections or optimistic overlays across SSR requests", async () => {
		const first = createFakeClient([{ id: "one", title: "First" }]);
		const second = createFakeClient([{ id: "one", title: "Second" }]);
		const firstRequest = createQuestpieCollections(first.client, {
			queryClient: new QueryClient(),
		});
		const secondRequest = createQuestpieCollections(second.client, {
			queryClient: new QueryClient(),
		});
		await Promise.all([
			firstRequest.collections.posts.preload(),
			secondRequest.collections.posts.preload(),
		]);

		expect(firstRequest.collections.posts).not.toBe(
			secondRequest.collections.posts,
		);
		const transaction = firstRequest.collections.posts.update(
			"one",
			(draft) => {
				draft.title = "First optimistic";
			},
		);
		expect(secondRequest.collections.posts.get("one")?.title).toBe("Second");
		await transaction.isPersisted.promise;

		firstRequest.destroy();
		secondRequest.destroy();
	});
});
