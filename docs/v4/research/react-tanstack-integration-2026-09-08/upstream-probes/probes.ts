import assert from "node:assert/strict";

import { createCollection, type SyncConfig } from "@tanstack/db";
import {
	QueryClient,
	QueryObserver,
	experimental_streamedQuery,
} from "@tanstack/query-core";

// Research probes of published upstream packages, not a QUESTPIE adapter.
type Row = { id: string; title: string; staffNote?: string };
type Sink = Parameters<SyncConfig<Row, string>["sync"]>[0];
const findings: object[] = [];
let fixtureId = 0;

function fixture(mode?: "partial" | "full", afterWrite?: () => void) {
	const gate = Promise.withResolvers<void>();
	let sink: Sink | undefined;
	const collection = createCollection<Row, string>({
		id: `research-${++fixtureId}`,
		getKey: (row) => row.id,
		startSync: true,
		sync: {
			...(mode ? { rowUpdateMode: mode } : {}),
			sync(next) {
				sink = next;
				next.begin();
				next.write({
					type: "insert",
					value: { id: "task", title: "old", staffNote: "synthetic-note" },
				});
				next.commit();
				next.markReady();
			},
		},
		onUpdate: async () => {
			await gate.promise;
			afterWrite?.();
		},
	});
	assert(sink, "startSync must synchronously acquire a sink");
	return { collection, sink, gate };
}

for (const mode of [undefined, "full"] as const) {
	const { collection, sink } = fixture(mode);
	await collection.preload();
	sink.begin();
	sink.write({ type: "update", value: { id: "task", title: "new" } });
	await sink.commit();
	const retainsOmittedField = Object.hasOwn(
		collection.get("task")!,
		"staffNote",
	);
	assert.equal(retainsOmittedField, mode === undefined);
	findings.push({
		probe: "complete-row-update",
		mode: mode ?? "default-partial",
		retainsOmittedField,
	});
	await collection.cleanup();
}

{
	const { collection, sink, gate } = fixture("full");
	await collection.preload();
	const transaction = collection.update("task", (draft) => {
		draft.title = "pending";
	});
	assert.equal(transaction.state, "persisting");
	sink.begin();
	sink.truncate();
	await sink.commit();
	assert.equal(collection.get("task")?.title, "pending");
	findings.push({
		probe: "truncate-with-pending-write",
		retainsOptimisticRow: true,
	});
	await collection.cleanup();
	assert.equal(collection.size, 0);
	sink.begin();
	sink.write({ type: "insert", value: { id: "late", title: "late" } });
	await sink.commit();
	assert.equal(collection.size, 0);
	gate.resolve();
	await transaction.isPersisted.promise;
	assert.equal(collection.size, 1);
	findings.push({
		probe: "cleanup",
		emptyAfterCleanupAndLateCallback: true,
		repopulatesAfterPendingSettlement: true,
		rowAfterSettlement: collection.get("task"),
	});
	await collection.preload();
	assert.equal(collection.get("task")?.title, "old");
	findings.push({
		probe: "retained-handle-preload",
		canRestartAfterCleanup: true,
	});
	await collection.cleanup();
}

{
	const { collection, sink, gate } = fixture("full");
	await collection.preload();
	const transaction = collection.update("task", (draft) => {
		draft.title = "pending";
	});
	sink.begin();
	sink.write({ type: "update", value: { id: "task", title: "confirmed" } });
	const receipt = sink.commit();
	assert.notEqual(receipt, true);
	let applied = false;
	const application = Promise.resolve(receipt).then(() => {
		applied = true;
	});
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(applied, false);
	assert.equal(transaction.state, "persisting");
	assert.equal(collection.get("task")?.title, "pending");
	gate.resolve();
	await transaction.isPersisted.promise;
	await application;
	assert.equal(collection.get("task")?.title, "confirmed");
	findings.push({
		probe: "queued-sync-receipt",
		waitsForPersistingHandler: true,
		appliesAfterHandlerResolves: true,
	});
	await collection.cleanup();
}

{
	const { collection, sink, gate } = fixture("full");
	await collection.preload();
	const transaction = collection.update("task", (draft) => {
		draft.title = "pending";
	});
	sink.begin({ immediate: true });
	sink.write({ type: "update", value: { id: "task", title: "restricted" } });
	assert.equal(sink.commit(), true);
	assert.equal(collection.get("task")?.staffNote, "synthetic-note");
	findings.push({
		probe: "full-replacement-with-pending-overlay",
		appliedReplacementStillHasOmittedFieldInVisibleOverlay: true,
	});
	gate.resolve();
	await transaction.isPersisted.promise;
	await collection.cleanup();
}

{
	let live = true;
	const { collection, gate } = fixture("full", () => {
		if (!live) throw new Error("synthetic-scope-retired");
	});
	await collection.preload();
	const transaction = collection.update("task", (draft) => {
		draft.title = "pending";
	});
	const settled = transaction.isPersisted.promise.catch(
		(error: Error) => error.message,
	);
	live = false;
	await collection.cleanup();
	gate.resolve();
	assert.equal(await settled, "synthetic-scope-retired");
	assert.equal(collection.size, 0);
	findings.push({
		probe: "retired-completion-guard",
		failedLocallyWithoutRepopulating: true,
	});
}

{
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	let fail = false;
	const options = {
		queryKey: ["synthetic-task"] as const,
		staleTime: Infinity,
		queryFn: async () => {
			if (fail) throw new Error("synthetic-refetch-denied");
			return { id: "task", title: "old" };
		},
	};
	await client.fetchQuery(options);
	const observer = new QueryObserver(client, options);
	const unsubscribe = observer.subscribe(() => {});
	fail = true;
	await client.invalidateQueries({ queryKey: options.queryKey });
	assert.equal(client.getQueryState(options.queryKey)?.status, "error");
	assert.equal(
		client.getQueryData<{ title: string }>(options.queryKey)?.title,
		"old",
	);
	findings.push({
		probe: "invalidate-denied-refetch",
		invalidationResolved: true,
		retainsOldDataInErrorState: true,
	});
	unsubscribe();
	client.clear();
}

{
	const client = new QueryClient();
	const consumed = Promise.withResolvers<void>();
	const finish = Promise.withResolvers<void>();
	const options = {
		queryKey: ["synthetic-live-task"] as const,
		queryFn: experimental_streamedQuery({
			streamFn: async function* () {
				yield { id: "task", title: "initial" };
				consumed.resolve();
				await finish.promise;
			},
			initialValue: null as Row | null,
			reducer: (_previous: Row | null, next: Row) => next,
		}),
	};
	let returned = false;
	const fetched = client.fetchQuery(options).then(() => {
		returned = true;
	});
	await consumed.promise;
	assert.equal(client.getQueryState(options.queryKey)?.status, "success");
	assert.equal(client.getQueryState(options.queryKey)?.fetchStatus, "fetching");
	assert.equal(returned, false);
	findings.push({
		probe: "stream-first-snapshot",
		dataAvailable: true,
		fetchingUntilStreamEnds: true,
		finitePrefetchNotSettled: true,
	});
	finish.resolve();
	await fetched;
	client.clear();
}

console.log(
	JSON.stringify(
		{
			status: "observed",
			packages: { db: "0.8.7", queryCore: "5.102.8" },
			findings,
		},
		null,
		2,
	),
);
