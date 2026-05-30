import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Files } from "files-sdk";
import { memory } from "files-sdk/memory";

import { runtimeConfig } from "../../src/server/config/create-app.js";
import { createFilesStorage } from "../../src/server/modules/core/integrated/storage/create-driver.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder.js";

describe("storage public API contract", () => {
	test("runtimeConfig accepts the adapter-first Files SDK storage shape", () => {
		const adapter = memory();

		const config = runtimeConfig({
			app: { url: "http://localhost:3000" },
			db: { url: "postgres://localhost/test" },
			storage: {
				adapter,
				defaultVisibility: "private",
				signedUrlExpiration: 120,
			},
		});

		expect(config.storage).toEqual({
			adapter,
			defaultVisibility: "private",
			signedUrlExpiration: 120,
		});
	});

	test("runtimeConfig rejects removed storage registration shapes", () => {
		expect(() =>
			runtimeConfig({
				app: { url: "http://localhost:3000" },
				db: { url: "postgres://localhost/test" },
				storage: { driver: {} } as any,
			}),
		).toThrow(/Unsupported storage config key/);

		expect(() =>
			runtimeConfig({
				app: { url: "http://localhost:3000" },
				db: { url: "postgres://localhost/test" },
				storage: { files: {} } as any,
			}),
		).toThrow(/Unsupported storage config key/);
	});

	test("createFilesStorage rejects explicit unknown storage objects", async () => {
		const config = runtimeConfig({
			app: { url: "http://localhost:3000" },
			db: { url: "postgres://localhost/test" },
			storage: { location: "./uploads" },
		});

		await expect(
			createFilesStorage({
				...config,
				storage: { unexpected: true },
			} as any),
		).rejects.toThrow(/Unknown storage config key/);
	});

	test("the storage target is a direct Files instance, not a disk manager", async () => {
		const adapter = memory();
		const storage = new Files({ adapter });

		await storage.upload("hello.txt", "hello", {
			contentType: "text/plain",
		});

		const file = await storage.download("hello.txt");

		expect(await file.text()).toBe("hello");
		expect(await storage.exists("hello.txt")).toBe(true);
		expect(typeof storage.upload).toBe("function");
		expect(typeof storage.download).toBe("function");
		expect(typeof storage.head).toBe("function");
		expect(typeof storage.delete).toBe("function");
		expect(typeof storage.copy).toBe("function");
		expect(typeof storage.move).toBe("function");
		expect(typeof storage.list).toBe("function");
		expect(typeof storage.listAll).toBe("function");
		expect(typeof storage.url).toBe("function");
		expect(typeof storage.signedUploadUrl).toBe("function");
		expect("use" in storage).toBe(false);
	});

	test("runtime storage adapter is sufficient to construct the app.storage target", async () => {
		const adapter = memory();
		const config = runtimeConfig({
			app: { url: "http://localhost:3000" },
			db: { url: "postgres://localhost/test" },
			storage: { adapter },
		});

		const appStorage = await createFilesStorage(config as any);

		expect(appStorage).toBeInstanceOf(Files);
		expect(appStorage.adapter).toBe(adapter);
		expect("use" in appStorage).toBe(false);
	});

	test("app.storage performs direct Files SDK operations", async () => {
		const setup = await buildMockApp({});

		try {
			await setup.app.storage.upload("direct.txt", "direct body", {
				contentType: "text/plain",
			});

			const file = await setup.app.storage.download("direct.txt");
			const metadata = await setup.app.storage.head("direct.txt");

			expect(setup.app.storage).toBeInstanceOf(Files);
			expect(await file.text()).toBe("direct body");
			expect(metadata.key).toBe("direct.txt");
			expect(metadata.type).toBe("text/plain");
			expect(await setup.app.storage.exists("direct.txt")).toBe(true);

			await setup.app.storage.delete("direct.txt");

			expect(await setup.app.storage.exists("direct.txt")).toBe(false);
			expect("use" in setup.app.storage).toBe(false);
		} finally {
			await setup.cleanup();
		}
	});

	test("local storage config creates a direct Files SDK instance", async () => {
		const location = await mkdtemp(join(tmpdir(), "questpie-storage-"));
		const config = runtimeConfig({
			app: { url: "http://localhost:3000" },
			db: { url: "postgres://localhost/test" },
			storage: { location },
		});

		try {
			const appStorage = await createFilesStorage(config as any);

			await appStorage.upload("local.txt", "local body", {
				contentType: "text/plain",
			});

			const file = await appStorage.download("local.txt");
			const metadata = await appStorage.head("local.txt");

			expect(appStorage).toBeInstanceOf(Files);
			expect(await file.text()).toBe("local body");
			expect(metadata.key).toBe("local.txt");
			expect(metadata.type).toBe("text/plain");
			expect(await appStorage.exists("local.txt")).toBe(true);

			await appStorage.delete("local.txt");

			expect(await appStorage.exists("local.txt")).toBe(false);
			expect("use" in appStorage).toBe(false);
		} finally {
			await rm(location, { force: true, recursive: true });
		}
	});
});
