import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Readable } from "node:stream";

import { storageCollectionServe } from "../../src/server/adapters/routes/storage.js";
import type {
	DriverContract,
	ObjectMetaData,
	ObjectVisibility,
	WriteOptions,
} from "flydrive/types";

import { Questpie, collection } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
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

const restrictedAssets = collection("restricted_assets")
	.access({ read: false })
	.fields(({ f }) => ({
		alt: f.text(500),
	}))
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

const createInstrumentedStorageDriver = (
	initialFiles: Record<string, Uint8Array> = {},
) => {
	const files = new Map(Object.entries(initialFiles));
	const calls = {
		put: 0,
		putStream: 0,
		getBytes: 0,
		getStream: 0,
		lastKey: "",
		lastWriteOptions: undefined as WriteOptions | undefined,
		lastWriteBody: new Uint8Array(),
		deletedKeys: [] as string[],
	};

	const getFile = (key: string) => {
		const file = files.get(key);
		if (!file) throw new Error(`Missing file: ${key}`);
		return file;
	};

	const driver: DriverContract = {
		async exists(key) {
			return files.has(key);
		},
		async get(key) {
			return textDecoder.decode(getFile(key));
		},
		async getStream(key) {
			calls.getStream++;
			return Readable.from([getFile(key)]);
		},
		async getBytes() {
			calls.getBytes++;
			throw new Error("getBytes should not be used by storage routes");
		},
		async getMetaData(key): Promise<ObjectMetaData> {
			const file = getFile(key);
			return {
				contentLength: file.byteLength,
				contentType: key.endsWith(".pdf") ? "application/pdf" : "text/plain",
				etag: `"${key}"`,
				lastModified: new Date("2026-01-01T00:00:00.000Z"),
			};
		},
		async getVisibility(): Promise<ObjectVisibility> {
			return "public";
		},
		async getUrl(key) {
			return `http://localhost:3000/assets/files/${encodeURIComponent(key)}`;
		},
		async getSignedUrl(key) {
			return `http://localhost:3000/assets/files/${encodeURIComponent(key)}?token=test`;
		},
		async getSignedUploadUrl(key) {
			return `http://localhost:3000/assets/files/${encodeURIComponent(key)}?upload=test`;
		},
		async setVisibility() {},
		async put(key, contents, options) {
			calls.put++;
			calls.lastKey = key;
			calls.lastWriteOptions = options;
			calls.lastWriteBody =
				typeof contents === "string" ? textEncoder.encode(contents) : contents;
			files.set(key, calls.lastWriteBody);
		},
		async putStream(key, contents, options) {
			calls.putStream++;
			calls.lastKey = key;
			calls.lastWriteOptions = options;
			const chunks: Uint8Array[] = [];
			for await (const chunk of contents) {
				chunks.push(normalizeChunk(chunk));
			}
			calls.lastWriteBody = mergeChunks(chunks);
			files.set(key, calls.lastWriteBody);
		},
		async copy(source, destination) {
			files.set(destination, getFile(source));
		},
		async move(source, destination) {
			files.set(destination, getFile(source));
			files.delete(source);
		},
		async delete(key) {
			calls.deletedKeys.push(key);
			files.delete(key);
		},
		async deleteAll(prefix) {
			for (const key of files.keys()) {
				if (key.startsWith(prefix)) files.delete(key);
			}
		},
		async listAll() {
			return [] as any;
		},
	};

	return { calls, driver, files };
};

// ==============================================================================
// TESTS
// ==============================================================================

describe("collection upload URL generation", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let app: (typeof setup)["app"];

	beforeEach(async () => {
		setup = await buildMockApp({ collections: { assets, services } });
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
		await setup.app.storage.use().put(key, new Uint8Array([1, 2, 3]), {
			contentType: "image/png",
		});

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
	});
});

describe("collection storage route streaming", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let app: (typeof setup)["app"];

	afterEach(async () => {
		await setup?.cleanup();
	});

	it("uploads form files through putStream with explicit content length", async () => {
		const storage = createInstrumentedStorageDriver();
		setup = await buildMockApp(
			{ collections: { assets } },
			{ storage: { driver: storage.driver } },
		);
		app = setup.app;
		app.storage.restore(Questpie.__internal.storageDriverServiceName);
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
		expect(json.size).toBe(body.byteLength);
		expect(storage.calls.putStream).toBe(1);
		expect(storage.calls.put).toBe(0);
		expect(storage.calls.lastWriteOptions?.contentLength).toBe(body.byteLength);
		expect(storage.calls.lastWriteOptions?.contentType).toBe("application/pdf");
		expect(textDecoder.decode(storage.calls.lastWriteBody)).toBe(
			"%PDF-1.4\nmenu",
		);
	});

	it("serves full files and ranges from storage streams", async () => {
		const fileBody = textEncoder.encode("abcdef");
		const storage = createInstrumentedStorageDriver({
			"file.txt": fileBody,
		});
		setup = await buildMockApp(
			{ collections: { assets } },
			{ storage: { driver: storage.driver } },
		);
		app = setup.app;
		app.storage.restore(Questpie.__internal.storageDriverServiceName);
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
		expect(full?.headers.get("content-length")).toBe("6");
		expect(await full!.text()).toBe("abcdef");
		expect(storage.calls.getStream).toBe(1);
		expect(storage.calls.getBytes).toBe(0);

		const range = await handler(
			new Request("http://localhost/api/assets/files/file.txt", {
				headers: { Range: "bytes=2-4" },
			}),
		);
		expect(range).not.toBeNull();
		expect(range?.status).toBe(206);
		expect(range?.headers.get("content-range")).toBe("bytes 2-4/6");
		expect(range?.headers.get("content-length")).toBe("3");
		expect(await range!.text()).toBe("cde");
		expect(storage.calls.getStream).toBe(2);
		expect(storage.calls.getBytes).toBe(0);
	});
});
