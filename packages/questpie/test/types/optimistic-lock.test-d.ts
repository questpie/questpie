import type { QuestpieClient } from "#questpie/client/index.js";
import { collection } from "#questpie/server/collection/builder/collection-builder.js";

const locked = collection("locked")
	.fields(({ f }) => ({
		name: f.text().required(),
		version: f.number().required().default(1),
	}))
	.options({
		softDelete: true,
		optimisticLock: { field: "version", required: true },
	});
const unlocked = collection("unlocked")
	.fields(({ f }) => ({
		name: f.text().required(),
	}))
	.options({ softDelete: true });

const lockedCollection = locked.build();
const unlockedCollection = unlocked.build();
declare const lockedCrud: ReturnType<typeof lockedCollection.generateCRUD>;
declare const unlockedCrud: ReturnType<typeof unlockedCollection.generateCRUD>;

lockedCrud.updateById({
	id: "record-1",
	expectedVersion: 1,
	data: { name: "Updated" },
});
lockedCrud.updateMany({
	where: { id: "record-1" },
	expectedVersions: [{ id: "record-1", expectedVersion: 1 }],
	data: { name: "Updated" },
});
lockedCrud.updateBatch({
	updates: [
		{
			id: "record-1",
			expectedVersion: 1,
			data: { name: "Updated" },
		},
	],
});
lockedCrud.deleteById({ id: "record-1", expectedVersion: 1 });
lockedCrud.deleteMany({
	where: { id: "record-1" },
	expectedVersions: [{ id: "record-1", expectedVersion: 1 }],
});
lockedCrud.restoreById({ id: "record-1", expectedVersion: 2 });
lockedCrud.purgeById({ id: "record-1", expectedVersion: 2 });
lockedCrud.revertToVersion({
	id: "record-1",
	version: 1,
	expectedVersion: 2,
});

// @ts-expect-error required optimistic locking forbids an unversioned by-id update
lockedCrud.updateById({ id: "record-1", data: { name: "Unsafe" } });
lockedCrud.updateById({
	id: "record-1",
	expectedVersion: 1,
	// @ts-expect-error the configured version field is framework-owned
	data: { version: 2 },
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
		locked: typeof locked;
		unlocked: typeof unlocked;
	};
};
declare const client: QuestpieClient<App>;

client.collections.locked.updateById({
	id: "record-1",
	expectedVersion: 1,
	data: { name: "Updated" },
});
client.collections.locked.deleteById({
	id: "record-1",
	expectedVersion: 1,
});
client.collections.locked.restoreById({
	id: "record-1",
	expectedVersion: 2,
});
client.collections.locked.purgeById({
	id: "record-1",
	expectedVersion: 2,
});
client.collections.locked.revertToVersion({
	id: "record-1",
	version: 1,
	expectedVersion: 2,
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
