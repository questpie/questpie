import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { Files, type Adapter, type Body, type UploadOptions } from "files-sdk";
import { memory } from "files-sdk/memory";

import { collection } from "../../src/exports/index.js";
import {
	createAdapterRoutes,
	createFetchHandler,
} from "../../src/server/adapters/http.js";
import { storageCollectionServe } from "../../src/server/adapters/routes/storage.js";
import { generateSignedUrlToken } from "../../src/server/modules/core/integrated/storage/signed-url.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

// ==============================================================================
// TEST COLLECTIONS SETUP
// ==============================================================================

// Assets collection with .upload() for URL generation testing
const assets = collection("assets")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		alt: f.text(500),
		caption: f.textarea(),
	}))
	.upload({
		visibility: "public",
	});

// Services collection that references assets (using f.relation())
const services = collection("services").fields(({ f }) => ({
	name: f.text(255).required(),
	image: f.relation("assets").relationName("image"),
}));

// Mirrors the autopilot `assets` Drive store: custom fields, a PRIVATE upload
// default, a per-row read rule, and a beforeChange hook that stamps key-bearing
// rows public only when visibility is unset. `.upload()` MUST come after
// `.fields()` — `.fields()` replaces the field map, so the reverse order drops
// the synthetic upload columns (key/visibility/...), which would silently store
// blobs with no recorded key (orphaned + unservable) and never persist
// visibility. This guards that a folder/Drive upload stays private and is not
// anonymously servable.
const driveAssets = collection("drive_assets")
	.options({ timestamps: true })
	.fields(({ f }) => ({
		title: f.text(),
		path: f.text().required(),
		body: f.textarea(),
	}))
	.upload({ visibility: "private" })
	.access({
		read: ({ session }) => (session ? true : { visibility: "public" }),
	})
	.hooks({
		beforeChange: ({ data, operation }) => {
			const row = data as { key?: unknown; visibility?: unknown };
			if (
				operation === "create" &&
				(row.visibility === undefined || row.visibility === null) &&
				typeof row.key === "string" &&
				row.key.length > 0
			) {
				row.visibility = "public";
			}
		},
	});

const restrictedAssets = collection("restricted_assets")
	.access({ read: false })
	.fields(({ f }) => ({
		alt: f.text(500),
	}))
	.upload({
		visibility: "public",
	});

const throwingAfterChangeAssets = collection("throwing_after_change_assets")
	.fields(({ f }) => ({
		alt: f.text(500),
	}))
	.hooks({
		afterChange: async ({ operation }) => {
			if (operation === "update") {
				throw new Error("afterChange failed");
			}
		},
	})
	.upload({
		visibility: "public",
	});

const throwingAfterDeleteAssets = collection("throwing_after_delete_assets")
	.fields(({ f }) => ({
		alt: f.text(500),
	}))
	.hooks({
		afterDelete: async () => {
			throw new Error("afterDelete failed");
		},
	})
	.upload({
		visibility: "public",
	});
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const mergeChunks = (chunks: Uint8Array[]) => {
	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const result = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return result;
};

const normalizeChunk = (chunk: unknown) => {
	if (chunk instanceof Uint8Array) return chunk;
	if (chunk instanceof ArrayBuffer) return new Uint8Array(chunk);
	if (ArrayBuffer.isView(chunk)) {
		return new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
	}
	return textEncoder.encode(String(chunk));
};

const readStream = async (stream: ReadableStream<Uint8Array>) => {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	while (true) {
		const next = await reader.read();
		if (next.done) break;
		chunks.push(normalizeChunk(next.value));
	}
	return mergeChunks(chunks);
};

const bodyToBytes = async (body: Body) => {
	if (typeof body === "string") return textEncoder.encode(body);
	if (body instanceof Uint8Array) return body;
	if (body instanceof ArrayBuffer) return new Uint8Array(body);
	if (ArrayBuffer.isView(body)) {
		return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
	}
	if (body instanceof Blob) {
		return new Uint8Array(await body.arrayBuffer());
	}
	return readStream(body);
};

const createInstrumentedStorageAdapter = (
	initialFiles: Record<string, Uint8Array> = {},
) => {
	const adapter = memory({
		initial: Object.fromEntries(
			Object.entries(initialFiles).map(([key, body]) => [
				key,
				{
					body,
					contentType: key.endsWith(".pdf") ? "application/pdf" : "text/plain",
				},
			]),
		),
	});
	const calls = {
		upload: 0,
		download: 0,
		head: 0,
		exists: 0,
		lastKey: "",
		lastUploadOptions: undefined as UploadOptions | undefined,
		lastUploadBody: new Uint8Array(),
		deletedKeys: [] as string[],
	};

	const instrumented: Adapter = {
		...adapter,
		async upload(key, body, options) {
			calls.upload++;
			calls.lastKey = key;
			calls.lastUploadOptions = options;
			calls.lastUploadBody = await bodyToBytes(body);
			return adapter.upload(key, calls.lastUploadBody, options);
		},
		async download(key, options) {
			calls.download++;
			return adapter.download(key, options);
		},
		async head(key, options) {
			calls.head++;
			return adapter.head(key, options);
		},
		async exists(key, options) {
			calls.exists++;
			return adapter.exists(key, options);
		},
		async delete(key) {
			calls.deletedKeys.push(key);
			return adapter.delete(key);
		},
	};

	return { adapter: instrumented, calls, files: adapter.raw };
};

// ==============================================================================
// TESTS
// ==============================================================================

describe("collection upload URL generation", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let app: (typeof setup)["app"];

	beforeEach(async () => {
		setup = await buildMockApp(
			{ collections: { assets, services } },
			{ secret: "test-secret" },
		);
		app = setup.app;
		await runTestDbMigrations(app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	describe("afterRead hook URL generation", () => {
		it("generates URL for assets when fetching directly", async () => {
			const ctx = createTestContext();
			const assetsCrud = app.collections.assets;

			// Create an asset with a key (simulating an uploaded file)
			const asset = await assetsCrud.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/test-image.png",
					filename: "test-image.png",
					mimeType: "image/png",
					size: 12345,
					visibility: "public",
					alt: "Test image",
				},
				ctx,
			);

			// Fetch the asset - URL should be generated by afterRead hook
			const fetchedAsset = await assetsCrud.findOne(
				{ where: { id: asset.id } },
				ctx,
			);

			expect(fetchedAsset).not.toBeNull();
			expect(fetchedAsset?.key).toBe("uploads/test-image.png");
			expect(fetchedAsset?.filename).toBe("test-image.png");
			// URL should be generated by the afterRead hook
			expect((fetchedAsset as any)?.url).toBeDefined();
			expect(typeof (fetchedAsset as any)?.url).toBe("string");
		});

		it("generates URL for assets in find (multiple records)", async () => {
			const ctx = createTestContext();
			const assetsCrud = app.collections.assets;

			// Create multiple assets
			await assetsCrud.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/image1.png",
					filename: "image1.png",
					mimeType: "image/png",
					size: 1000,
					visibility: "public",
				},
				ctx,
			);

			await assetsCrud.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/image2.jpg",
					filename: "image2.jpg",
					mimeType: "image/jpeg",
					size: 2000,
					visibility: "public",
				},
				ctx,
			);

			// Fetch all assets
			const { docs } = await assetsCrud.find({}, ctx);

			expect(docs).toHaveLength(2);
			// All assets should have URLs
			for (const asset of docs) {
				expect((asset as any).url).toBeDefined();
				expect(typeof (asset as any).url).toBe("string");
			}
		});

		it("generates URL for assets when expanding relations", async () => {
			const ctx = createTestContext();
			const assetsCrud = app.collections.assets;
			const servicesCrud = app.collections.services;

			// Create an asset
			const asset = await assetsCrud.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/service-image.png",
					filename: "service-image.png",
					mimeType: "image/png",
					size: 5000,
					visibility: "public",
				},
				ctx,
			);

			// Create a service referencing the asset (using field name with unified API)
			const service = await servicesCrud.create(
				{
					id: crypto.randomUUID(),
					name: "Haircut",
					image: asset.id, // FK column key is field name with unified API
				} as any,
				ctx,
			);

			// Fetch service with expanded image relation
			const serviceWithImage = (await servicesCrud.findOne(
				{ where: { id: service.id }, with: { image: true } },
				ctx,
			)) as any;

			expect(serviceWithImage).not.toBeNull();
			expect(serviceWithImage?.image).not.toBeNull();
			expect(serviceWithImage?.image?.id).toBe(asset.id);
			expect(serviceWithImage?.image?.filename).toBe("service-image.png");
			// URL should be generated for the expanded relation
			expect(serviceWithImage?.image?.url).toBeDefined();
			expect(typeof serviceWithImage?.image?.url).toBe("string");
		});

		it("URL generation handles both public and private visibility", async () => {
			const ctx = createTestContext();
			const assetsCrud = app.collections.assets;

			// Create a public asset
			const publicAsset = await assetsCrud.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/public-image.png",
					filename: "public-image.png",
					mimeType: "image/png",
					size: 1000,
					visibility: "public",
				},
				ctx,
			);

			// Create a private asset
			const privateAsset = await assetsCrud.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/private-image.png",
					filename: "private-image.png",
					mimeType: "image/png",
					size: 1000,
					visibility: "private",
				},
				ctx,
			);

			// Fetch both assets
			const fetchedPublic = await assetsCrud.findOne(
				{ where: { id: publicAsset.id } },
				ctx,
			);
			const fetchedPrivate = await assetsCrud.findOne(
				{ where: { id: privateAsset.id } },
				ctx,
			);

			// Both should have URLs generated
			expect((fetchedPublic as any)?.url).toBeDefined();
			expect((fetchedPrivate as any)?.url).toBeDefined();
			// Both should be strings (signed URLs for private, regular URLs for public)
			expect(typeof (fetchedPublic as any)?.url).toBe("string");
			expect(typeof (fetchedPrivate as any)?.url).toBe("string");
		});
	});
});

describe("collection upload storage access", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	beforeEach(async () => {
		setup = await buildMockApp({
			collections: { restricted_assets: restrictedAssets },
		});
		await runTestDbMigrations(setup.app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("does not serve a storage object when the upload row is not readable", async () => {
		const key = "uploads/restricted.png";
		const storage = createInstrumentedStorageAdapter({
			[key]: new Uint8Array([1, 2, 3]),
		});
		await setup.cleanup();
		setup = await buildMockApp(
			{
				collections: { restricted_assets: restrictedAssets },
			},
			{ storage: { adapter: storage.adapter } },
		);
		await runTestDbMigrations(setup.app);

		await setup.app.collections.restricted_assets.create(
			{
				id: crypto.randomUUID(),
				key,
				filename: "restricted.png",
				mimeType: "image/png",
				size: 3,
				visibility: "public",
				alt: "Restricted",
			},
			createTestContext(),
		);

		const response = await storageCollectionServe(
			setup.app,
			new Request(`http://localhost:3000/restricted_assets/files/${key}`),
			{ collection: "restricted_assets", key },
			undefined,
			{ getSession: async () => null },
		);

		expect(response.status).toBe(403);
		expect(storage.calls.exists).toBe(0);
		expect(storage.calls.head).toBe(0);
		expect(storage.calls.download).toBe(0);
	});
});

describe("collection storage route streaming", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let app: (typeof setup)["app"];

	afterEach(async () => {
		await setup?.cleanup();
	});

	it("uploads form files through the Files adapter", async () => {
		const storage = createInstrumentedStorageAdapter();
		setup = await buildMockApp(
			{ collections: { assets } },
			{ storage: { adapter: storage.adapter } },
		);
		app = setup.app;
		await runTestDbMigrations(app);

		const handler = createFetchHandler(app, {
			accessMode: "system",
			basePath: "/api",
			requestLogging: false,
		});
		const body = textEncoder.encode("%PDF-1.4\nmenu");
		const formData = new FormData();
		formData.append(
			"file",
			new File([body], "menu.pdf", { type: "application/pdf" }),
		);

		const response = await handler(
			new Request("http://localhost/api/assets/upload", {
				method: "POST",
				body: formData,
			}),
		);
		expect(response).not.toBeNull();
		expect(response?.status).toBe(200);

		const json = (await response!.json()) as any;
		expect(json.filename).toBe("menu.pdf");
		expect(json.key).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
		expect(json.size).toBe(body.byteLength);
		expect(storage.calls.upload).toBe(1);
		expect(storage.calls.lastUploadOptions?.contentType).toBe(
			"application/pdf",
		);
		expect(textDecoder.decode(storage.calls.lastUploadBody)).toBe(
			"%PDF-1.4\nmenu",
		);
	});

	it("returns file URLs keyed by storage key and serves them through the API base path", async () => {
		const storage = createInstrumentedStorageAdapter();
		setup = await buildMockApp(
			{ collections: { assets } },
			{ storage: { adapter: storage.adapter, basePath: "/api" } },
		);
		app = setup.app;
		await runTestDbMigrations(app);

		const handler = createFetchHandler(app, {
			accessMode: "system",
			basePath: "/api",
			requestLogging: false,
		});
		const body = textEncoder.encode("avatar-bytes");
		const formData = new FormData();
		formData.append(
			"file",
			new File([body], "avatar.png", { type: "image/png" }),
		);

		const uploadResponse = await handler(
			new Request("http://localhost:3000/api/assets/upload", {
				method: "POST",
				body: formData,
			}),
		);
		expect(uploadResponse).not.toBeNull();
		expect(uploadResponse?.status).toBe(200);

		const uploaded = (await uploadResponse!.json()) as any;
		expect(uploaded.id).toBeString();
		expect(uploaded.key).toBeString();
		expect(uploaded.id).not.toBe(uploaded.key);
		expect(uploaded.url).toBe(
			`http://localhost:3000/api/assets/files/${uploaded.key}`,
		);
		expect(uploaded.url).not.toBe(
			`http://localhost:3000/api/assets/files/${uploaded.id}`,
		);

		const served = await handler(new Request(uploaded.url));
		expect(served).not.toBeNull();
		expect(served?.status).toBe(200);
		expect(await served!.text()).toBe("avatar-bytes");
		expect(storage.calls.exists).toBe(1);
		expect(storage.calls.head).toBe(1);
		expect(storage.calls.download).toBe(1);

		const idUrl = `http://localhost:3000/api/assets/files/${uploaded.id}`;
		const servedById = await handler(new Request(idUrl));
		expect(servedById).not.toBeNull();
		expect(servedById?.status).toBe(404);
		expect(storage.calls.exists).toBe(1);
		expect(storage.calls.head).toBe(1);
		expect(storage.calls.download).toBe(1);
	});

	it("sanitizes uploaded filenames and keeps storage keys path-safe", async () => {
		const storage = createInstrumentedStorageAdapter();
		setup = await buildMockApp(
			{ collections: { assets } },
			{ storage: { adapter: storage.adapter } },
		);
		app = setup.app;
		await runTestDbMigrations(app);

		const body = textEncoder.encode("avatar");
		const uploaded = await (app.collections.assets as any).upload(
			{
				name: "../../../avatar.txt",
				type: "text/plain",
				size: body.byteLength,
				arrayBuffer: async () =>
					body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
			},
			createTestContext({ accessMode: "system" }),
		);

		expect(uploaded.filename).toBe("avatar.txt");
		expect(uploaded.key).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
		expect(storage.calls.lastKey).toBe(uploaded.key);
		expect(storage.calls.lastKey).not.toContain("/");
		expect(storage.calls.lastKey).not.toContain("..");
	});

	it("rejects dangerous double-extension uploads", async () => {
		const storage = createInstrumentedStorageAdapter();
		setup = await buildMockApp(
			{ collections: { assets } },
			{ storage: { adapter: storage.adapter } },
		);
		app = setup.app;
		await runTestDbMigrations(app);

		const body = textEncoder.encode("image");
		await expect(
			(app.collections.assets as any).upload(
				{
					name: "shell.php.jpg",
					type: "image/jpeg",
					size: body.byteLength,
					arrayBuffer: async () =>
						body.buffer.slice(
							body.byteOffset,
							body.byteOffset + body.byteLength,
						),
				},
				createTestContext({ accessMode: "system" }),
			),
		).rejects.toThrow('File extension ".php" is not allowed');
		expect(storage.calls.upload).toBe(0);
	});

	it("removes the stored object when upload row creation fails", async () => {
		const storage = createInstrumentedStorageAdapter();
		setup = await buildMockApp(
			{ collections: { assets } },
			{ storage: { adapter: storage.adapter } },
		);
		app = setup.app;
		await runTestDbMigrations(app);

		const body = textEncoder.encode("private");
		const file = new File([body], "private.txt", { type: "text/plain" });

		await expect(
			(app.collections.assets as any).upload(
				file,
				createTestContext({ accessMode: "user", session: null }),
			),
		).rejects.toThrow();

		expect(storage.calls.upload).toBe(1);
		expect(storage.calls.deletedKeys).toEqual([storage.calls.lastKey]);
		expect(await app.storage.exists(storage.calls.lastKey)).toBe(false);
		const rows = await app.collections.assets.find({}, createTestContext());
		expect(rows.docs).toHaveLength(0);
	});

	it("removes the previous stored object after an upload row key update", async () => {
		const oldBody = textEncoder.encode("old");
		const newBody = textEncoder.encode("new");
		const storage = createInstrumentedStorageAdapter({
			"old.txt": oldBody,
			"new.txt": newBody,
		});
		setup = await buildMockApp(
			{ collections: { assets } },
			{ storage: { adapter: storage.adapter } },
		);
		app = setup.app;
		await runTestDbMigrations(app);

		const asset = await app.collections.assets.create(
			{
				id: crypto.randomUUID(),
				key: "old.txt",
				filename: "old.txt",
				mimeType: "text/plain",
				size: oldBody.byteLength,
				visibility: "public",
			},
			createTestContext(),
		);

		const updated = await app.collections.assets.updateById(
			{
				id: asset.id,
				data: {
					key: "new.txt",
					filename: "new.txt",
					size: newBody.byteLength,
				},
			},
			createTestContext(),
		);

		expect(updated.key).toBe("new.txt");
		expect(storage.calls.deletedKeys).toEqual(["old.txt"]);
		expect(await app.storage.exists("old.txt")).toBe(false);
		expect(await app.storage.exists("new.txt")).toBe(true);
	});

	it("removes the previous stored object when a user afterChange hook throws", async () => {
		const oldBody = textEncoder.encode("old");
		const newBody = textEncoder.encode("new");
		const storage = createInstrumentedStorageAdapter({
			"old-throwing-after-change.txt": oldBody,
			"new-throwing-after-change.txt": newBody,
		});
		setup = await buildMockApp(
			{ collections: { assets: throwingAfterChangeAssets } },
			{ storage: { adapter: storage.adapter } },
		);
		app = setup.app;
		await runTestDbMigrations(app);

		const asset = await app.collections.assets.create(
			{
				id: crypto.randomUUID(),
				key: "old-throwing-after-change.txt",
				filename: "old-throwing-after-change.txt",
				mimeType: "text/plain",
				size: oldBody.byteLength,
				visibility: "public",
			},
			createTestContext(),
		);

		const updated = await app.collections.assets.updateById(
			{
				id: asset.id,
				data: {
					key: "new-throwing-after-change.txt",
					filename: "new-throwing-after-change.txt",
					size: newBody.byteLength,
				},
			},
			createTestContext(),
		);

		expect(updated.key).toBe("new-throwing-after-change.txt");
		expect(storage.calls.deletedKeys).toEqual([
			"old-throwing-after-change.txt",
		]);
		expect(await app.storage.exists("old-throwing-after-change.txt")).toBe(
			false,
		);
		expect(await app.storage.exists("new-throwing-after-change.txt")).toBe(
			true,
		);
	});

	it("removes the stored object after an upload row delete", async () => {
		const body = textEncoder.encode("delete me");
		const storage = createInstrumentedStorageAdapter({
			"delete.txt": body,
		});
		setup = await buildMockApp(
			{ collections: { assets } },
			{ storage: { adapter: storage.adapter } },
		);
		app = setup.app;
		await runTestDbMigrations(app);

		const asset = await app.collections.assets.create(
			{
				id: crypto.randomUUID(),
				key: "delete.txt",
				filename: "delete.txt",
				mimeType: "text/plain",
				size: body.byteLength,
				visibility: "public",
			},
			createTestContext(),
		);

		const result = await app.collections.assets.deleteById(
			{ id: asset.id },
			createTestContext(),
		);

		expect(result.success).toBe(true);
		expect(storage.calls.deletedKeys).toEqual(["delete.txt"]);
		expect(await app.storage.exists("delete.txt")).toBe(false);
		const deleted = await app.collections.assets.findOne(
			{ where: { id: asset.id } },
			createTestContext(),
		);
		expect(deleted).toBeNull();
	});

	it("removes the stored object when a user afterDelete hook throws", async () => {
		const body = textEncoder.encode("delete me");
		const storage = createInstrumentedStorageAdapter({
			"delete-throwing-after-delete.txt": body,
		});
		setup = await buildMockApp(
			{ collections: { assets: throwingAfterDeleteAssets } },
			{ storage: { adapter: storage.adapter } },
		);
		app = setup.app;
		await runTestDbMigrations(app);

		const asset = await app.collections.assets.create(
			{
				id: crypto.randomUUID(),
				key: "delete-throwing-after-delete.txt",
				filename: "delete-throwing-after-delete.txt",
				mimeType: "text/plain",
				size: body.byteLength,
				visibility: "public",
			},
			createTestContext(),
		);

		const result = await app.collections.assets.deleteById(
			{ id: asset.id },
			createTestContext(),
		);

		expect(result.success).toBe(true);
		expect(storage.calls.deletedKeys).toEqual([
			"delete-throwing-after-delete.txt",
		]);
		expect(await app.storage.exists("delete-throwing-after-delete.txt")).toBe(
			false,
		);
		const deleted = await app.collections.assets.findOne(
			{ where: { id: asset.id } },
			createTestContext(),
		);
		expect(deleted).toBeNull();
	});

	it("removes stored objects for later bulk delete rows when a user afterDelete hook throws", async () => {
		const bodyA = textEncoder.encode("delete me a");
		const bodyB = textEncoder.encode("delete me b");
		const storage = createInstrumentedStorageAdapter({
			"bulk-delete-throwing-after-delete-a.txt": bodyA,
			"bulk-delete-throwing-after-delete-b.txt": bodyB,
		});
		setup = await buildMockApp(
			{ collections: { assets: throwingAfterDeleteAssets } },
			{ storage: { adapter: storage.adapter } },
		);
		app = setup.app;
		await runTestDbMigrations(app);

		const first = await app.collections.assets.create(
			{
				id: crypto.randomUUID(),
				key: "bulk-delete-throwing-after-delete-a.txt",
				filename: "bulk-delete-throwing-after-delete-a.txt",
				mimeType: "text/plain",
				size: bodyA.byteLength,
				visibility: "public",
			},
			createTestContext(),
		);
		const second = await app.collections.assets.create(
			{
				id: crypto.randomUUID(),
				key: "bulk-delete-throwing-after-delete-b.txt",
				filename: "bulk-delete-throwing-after-delete-b.txt",
				mimeType: "text/plain",
				size: bodyB.byteLength,
				visibility: "public",
			},
			createTestContext(),
		);

		const result = await app.collections.assets.delete(
			{ where: { id: { in: [first.id, second.id] } } },
			createTestContext(),
		);

		expect(result).toEqual({ success: true, count: 2 });
		expect([...storage.calls.deletedKeys].sort()).toEqual([
			"bulk-delete-throwing-after-delete-a.txt",
			"bulk-delete-throwing-after-delete-b.txt",
		]);
		expect(
			await app.storage.exists("bulk-delete-throwing-after-delete-a.txt"),
		).toBe(false);
		expect(
			await app.storage.exists("bulk-delete-throwing-after-delete-b.txt"),
		).toBe(false);
		const remaining = await app.collections.assets.find(
			{ where: { id: { in: [first.id, second.id] } } },
			createTestContext(),
		);
		expect(remaining.docs).toHaveLength(0);
	});

	it("serves full files and ranges from storage streams", async () => {
		const fileBody = textEncoder.encode("abcdef");
		const storage = createInstrumentedStorageAdapter({
			"file.txt": fileBody,
		});
		setup = await buildMockApp(
			{ collections: { assets } },
			{ storage: { adapter: storage.adapter } },
		);
		app = setup.app;
		await runTestDbMigrations(app);

		await app.collections.assets.create(
			{
				id: crypto.randomUUID(),
				key: "file.txt",
				filename: "file.txt",
				mimeType: "text/plain",
				size: fileBody.byteLength,
				visibility: "public",
			},
			createTestContext(),
		);

		const handler = createFetchHandler(app, {
			basePath: "/api",
			requestLogging: false,
		});

		const full = await handler(
			new Request("http://localhost/api/assets/files/file.txt"),
		);
		expect(full).not.toBeNull();
		expect(full?.status).toBe(200);
		expect(full?.headers.get("content-type")).toBe("text/plain");
		expect(full?.headers.get("x-content-type-options")).toBe("nosniff");
		expect(full?.headers.get("content-disposition")).toBe(
			'inline; filename="file.txt"',
		);
		expect(full?.headers.get("content-length")).toBe("6");
		expect(await full!.text()).toBe("abcdef");
		expect(storage.calls.exists).toBe(1);
		expect(storage.calls.download).toBe(1);
		expect(storage.calls.head).toBe(1);

		const range = await handler(
			new Request("http://localhost/api/assets/files/file.txt", {
				headers: { Range: "bytes=2-4" },
			}),
		);
		expect(range).not.toBeNull();
		expect(range?.status).toBe(206);
		expect(range?.headers.get("x-content-type-options")).toBe("nosniff");
		expect(range?.headers.get("content-range")).toBe("bytes 2-4/6");
		expect(range?.headers.get("content-length")).toBe("3");
		expect(await range!.text()).toBe("cde");
		expect(storage.calls.exists).toBe(2);
		expect(storage.calls.download).toBe(2);
		expect(storage.calls.head).toBe(2);
	});

	it("serves files through storage from the resolved handler context", async () => {
		const fileBody = textEncoder.encode("context file");
		const appStorage = createInstrumentedStorageAdapter();
		const contextStorage = createInstrumentedStorageAdapter({
			"context-file.txt": fileBody,
		});
		setup = await buildMockApp(
			{ collections: { assets } },
			{ storage: { adapter: appStorage.adapter } },
		);
		app = setup.app;
		await runTestDbMigrations(app);

		await app.collections.assets.create(
			{
				id: crypto.randomUUID(),
				key: "context-file.txt",
				filename: "context-file.txt",
				mimeType: "text/plain",
				size: fileBody.byteLength,
				visibility: "public",
			},
			createTestContext(),
		);

		const appContext = await app.createContext({
			accessMode: "system",
			locale: "en",
		});
		const contextStorageClient = new Files({
			adapter: contextStorage.adapter,
		});

		const response = await storageCollectionServe(
			app,
			new Request("http://localhost/assets/files/context-file.txt"),
			{ collection: "assets", key: "context-file.txt" },
			{
				appContext: {
					...appContext,
					storage: contextStorageClient,
				},
				locale: appContext.locale,
				session: appContext.session,
			},
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("context file");
		expect(appStorage.calls.exists).toBe(0);
		expect(contextStorage.calls.exists).toBe(1);
		expect(contextStorage.calls.head).toBe(1);
		expect(contextStorage.calls.download).toBe(1);
	});

	it("serves files through createAdapterRoutes compatibility when context is omitted", async () => {
		const fileBody = textEncoder.encode("standalone route");
		const storage = createInstrumentedStorageAdapter({
			"standalone-file.txt": fileBody,
		});
		setup = await buildMockApp(
			{ collections: { assets } },
			{ storage: { adapter: storage.adapter } },
		);
		app = setup.app;
		await runTestDbMigrations(app);

		await app.collections.assets.create(
			{
				id: crypto.randomUUID(),
				key: "standalone-file.txt",
				filename: "standalone-file.txt",
				mimeType: "text/plain",
				size: fileBody.byteLength,
				visibility: "public",
			},
			createTestContext(),
		);

		const routes = createAdapterRoutes(app, {
			getSession: async () => null,
		});
		const response = await routes.collectionServe(
			new Request("http://localhost/assets/files/standalone-file.txt"),
			{ collection: "assets", key: "standalone-file.txt" },
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("standalone route");
		expect(storage.calls.exists).toBe(1);
		expect(storage.calls.head).toBe(1);
		expect(storage.calls.download).toBe(1);
	});

	it("checks private file tokens before accessing storage", async () => {
		const fileBody = textEncoder.encode("secret file");
		const storage = createInstrumentedStorageAdapter({
			"private-file.txt": fileBody,
		});
		setup = await buildMockApp(
			{ collections: { assets } },
			{
				secret: "test-secret",
				storage: { adapter: storage.adapter },
			},
		);
		app = setup.app;
		await runTestDbMigrations(app);

		await app.collections.assets.create(
			{
				id: crypto.randomUUID(),
				key: "private-file.txt",
				filename: "private-file.txt",
				mimeType: "text/plain",
				size: fileBody.byteLength,
				visibility: "private",
			},
			createTestContext(),
		);

		const handler = createFetchHandler(app, {
			basePath: "/api",
			requestLogging: false,
		});

		const missingToken = await handler(
			new Request("http://localhost/api/assets/files/private-file.txt"),
		);
		expect(missingToken).not.toBeNull();
		expect(missingToken?.status).toBe(401);
		expect(storage.calls.exists).toBe(0);
		expect(storage.calls.head).toBe(0);
		expect(storage.calls.download).toBe(0);

		const token = await generateSignedUrlToken(
			"private-file.txt",
			"test-secret",
			60,
			"assets",
		);
		const served = await handler(
			new Request(
				`http://localhost/api/assets/files/private-file.txt?token=${token}`,
			),
		);

		expect(served).not.toBeNull();
		expect(served?.status).toBe(200);
		expect(await served!.text()).toBe("secret file");
		expect(storage.calls.exists).toBe(1);
		expect(storage.calls.head).toBe(1);
		expect(storage.calls.download).toBe(1);
	});
});

describe("private-default Drive upload visibility", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let app: (typeof setup)["app"];

	beforeEach(async () => {
		setup = await buildMockApp(
			{ collections: { drive_assets: driveAssets } },
			{ secret: "test-secret" },
		);
		app = setup.app;
		await runTestDbMigrations(app);
	});

	afterEach(async () => {
		await setup.cleanup();
	});

	it("a folder upload stays private, records its key, and is not anonymously served", async () => {
		const body = textEncoder.encode("confidential pdf");
		const uploaded = await (app.collections.drive_assets as any).upload(
			{
				name: "secret.pdf",
				type: "application/pdf",
				size: body.byteLength,
				arrayBuffer: async () =>
					body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength),
			},
			createTestContext({ accessMode: "system" }),
			{ path: "company/confidential/secret.pdf" },
		);

		// The synthetic upload columns survive: the blob row records its key and
		// keeps the collection's private default (the public-stamp hook only fires
		// when visibility is unset, which never happens once the column exists).
		expect((uploaded as any).key).toBeString();
		expect((uploaded as any).visibility).toBe("private");
		expect((uploaded as any).path).toBe("company/confidential/secret.pdf");

		// Anonymous serve must never return the bytes. The per-row read rule hides
		// the private row from anonymous callers, so the route 404s before touching
		// storage — a private blob is indistinguishable from a missing one.
		const handler = createFetchHandler(app, {
			basePath: "/api",
			requestLogging: false,
		});
		const key = (uploaded as any).key as string;
		const anon = await handler(
			new Request(`http://localhost/api/drive_assets/files/${key}`),
		);
		expect(anon?.status).not.toBe(200);
	});
});
