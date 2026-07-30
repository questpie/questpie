import type { QuestpieClient } from "#questpie/client/index.js";
import { collection } from "#questpie/server/collection/builder/collection-builder.js";
import { global } from "#questpie/server/global/builder/global-builder.js";

const revisioned = collection("revisioned")
	.fields(({ f }) => ({
		name: f.text().required(),
	}))
	.options({
		softDelete: true,
		optimisticConcurrency: true,
	});
const unlocked = collection("unlocked")
	.fields(({ f }) => ({
		name: f.text().required(),
	}))
	.options({ softDelete: true });

const lockedCollection = revisioned.build();
const unlockedCollection = unlocked.build();
declare const lockedCrud: ReturnType<typeof lockedCollection.generateCRUD>;
declare const unlockedCrud: ReturnType<typeof unlockedCollection.generateCRUD>;

const revisionedGlobal = global("revisioned-global")
	.fields(({ f }) => ({ title: f.text().required() }))
	.options({
		optimisticConcurrency: true,
		versioning: { workflow: true },
	});
const revisionedGlobalDefinition = revisionedGlobal.build();
declare const revisionedGlobalCrud: ReturnType<
	typeof revisionedGlobalDefinition.generateCRUD
>;

revisionedGlobalCrud.update({
	data: { title: "Updated" },
	expectedRevision: 1,
});
revisionedGlobalCrud.transitionStage({
	stage: "published",
	expectedRevision: 2,
});
revisionedGlobalCrud.revertToVersion({
	version: 1,
	expectedRevision: 3,
});
// @ts-expect-error global update requires the expected revision
revisionedGlobalCrud.update({ data: { title: "Unsafe" } });
// @ts-expect-error global transition requires the expected revision
revisionedGlobalCrud.transitionStage({ stage: "published" });
// @ts-expect-error global revert requires the expected revision
revisionedGlobalCrud.revertToVersion({ version: 1 });

lockedCrud.updateById({
	id: "record-1",
	expectedRevision: 1,
	data: { name: "Updated" },
});
lockedCrud.updateMany({
	where: { id: "record-1" },
	expectedRevisions: [{ id: "record-1", expectedRevision: 1 }],
	data: { name: "Updated" },
});
lockedCrud.updateBatch({
	updates: [
		{
			id: "record-1",
			expectedRevision: 1,
			data: { name: "Updated" },
		},
	],
});
lockedCrud.deleteById({ id: "record-1", expectedRevision: 1 });
lockedCrud.deleteMany({
	where: { id: "record-1" },
	expectedRevisions: [{ id: "record-1", expectedRevision: 1 }],
});
lockedCrud.restoreById({ id: "record-1", expectedRevision: 2 });
lockedCrud.purgeById({ id: "record-1", expectedRevision: 2 });
lockedCrud.revertToVersion({
	id: "record-1",
	version: 1,
	expectedRevision: 2,
});

// @ts-expect-error required optimistic locking forbids an unversioned by-id update
lockedCrud.updateById({ id: "record-1", data: { name: "Unsafe" } });
lockedCrud.updateById({
	id: "record-1",
	expectedRevision: 1,
	// @ts-expect-error the canonical revision is framework-owned
	data: { revision: 2 },
});
// @ts-expect-error bulk updates require exact per-id version inputs
lockedCrud.updateMany({
	where: { id: "record-1" },
	data: { name: "Unsafe" },
});
lockedCrud.updateBatch({
	// @ts-expect-error each updateBatch entry requires its own expected version
	updates: [{ id: "record-1", data: { name: "Unsafe" } }],
});
// @ts-expect-error delete requires the expected version
lockedCrud.deleteById({ id: "record-1" });
// @ts-expect-error deleteMany requires exact per-id version inputs
lockedCrud.deleteMany({ where: { id: "record-1" } });
// @ts-expect-error restore requires the expected version
lockedCrud.restoreById({ id: "record-1" });
// @ts-expect-error purge requires the current tombstone version
lockedCrud.purgeById({ id: "record-1" });
// @ts-expect-error revert requires the expected version
lockedCrud.revertToVersion({ id: "record-1", version: 1 });

unlockedCrud.updateById({ id: "record-1", data: { name: "Legacy" } });
unlockedCrud.updateMany({
	where: { id: "record-1" },
	data: { name: "Legacy" },
});
unlockedCrud.updateBatch({
	updates: [{ id: "record-1", data: { name: "Legacy" } }],
});
unlockedCrud.deleteById({ id: "record-1" });
unlockedCrud.deleteMany({ where: { id: "record-1" } });
unlockedCrud.purgeById({ id: "record-1" });

type App = {
	collections: {
		locked: typeof revisioned;
		unlocked: typeof unlocked;
	};
};
declare const client: QuestpieClient<App>;

client.collections.locked.updateById({
	id: "record-1",
	expectedRevision: 1,
	data: { name: "Updated" },
});
client.collections.locked
	.deleteById({
		id: "record-1",
		expectedRevision: 1,
	})
	.then((result) => {
		const revision: number = result.data.revision;
		return revision;
	});
client.collections.locked.deleteById({
	id: "record-1",
	expectedRevision: 1,
});
client.collections.locked.restoreById({
	id: "record-1",
	expectedRevision: 2,
});
client.collections.locked.purgeById({
	id: "record-1",
	expectedRevision: 2,
});
client.collections.locked.revertToVersion({
	id: "record-1",
	version: 1,
	expectedRevision: 2,
});
// @ts-expect-error client by-id update inherits required optimistic locking
client.collections.locked.updateById({
	id: "record-1",
	data: { name: "Unsafe" },
});
// @ts-expect-error client delete inherits required optimistic locking
client.collections.locked.deleteById({ id: "record-1" });
// @ts-expect-error client restore inherits required optimistic locking
client.collections.locked.restoreById({ id: "record-1" });
// @ts-expect-error client purge inherits required optimistic locking
client.collections.locked.purgeById({ id: "record-1" });
// @ts-expect-error client revert inherits required optimistic locking
client.collections.locked.revertToVersion({ id: "record-1", version: 1 });

client.collections.unlocked.updateById({
	id: "record-1",
	data: { name: "Legacy" },
});
client.collections.unlocked.deleteById({ id: "record-1" });
client.collections.unlocked.purgeById({ id: "record-1" });
