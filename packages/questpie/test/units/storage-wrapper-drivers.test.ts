/**
 * Tests for `questpie/storage` — R2Driver factory + makeProxyUrlBuilder utility.
 *
 * Covers the same surface that storage-driver.test.ts covers for the built-in
 * FSDriver path, plus R2-specific concerns (R2 conventions applied,
 * publicUrl override, signed URLs always proxied).
 */

import { describe, expect, test } from "bun:test";

import type { QuestpieConfig } from "../../src/server/config/types.js";
import { createDiskDriver } from "../../src/server/modules/core/integrated/storage/create-driver.js";
import { makeProxyUrlBuilder } from "../../src/server/modules/core/integrated/storage/drivers/factory.js";
import { R2Driver } from "../../src/server/modules/core/integrated/storage/drivers/r2.js";
import { verifySignedUrlToken } from "../../src/server/modules/core/integrated/storage/signed-url.js";

const createMockConfig = (
	overrides: Partial<QuestpieConfig> = {},
): QuestpieConfig =>
	({
		app: { url: "http://localhost:3000", name: "test" },
		db: { url: "postgres://localhost/test" },
		secret: "test-secret",
		...overrides,
	}) as QuestpieConfig;

describe("makeProxyUrlBuilder", () => {
	test("generateURL returns proxy URL by default", async () => {
		const config = createMockConfig();
		const proxy = makeProxyUrlBuilder(config);

		const url = await proxy.generateURL("avatars/me.png");

		expect(url).toBe(
			"http://localhost:3000/storage/files/avatars%2Fme.png",
		);
	});

	test("generateURL returns publicUrl/<key> when publicUrl is set", async () => {
		const config = createMockConfig();
		const proxy = makeProxyUrlBuilder(config, {
			publicUrl: "https://cdn.example.com",
		});

		const url = await proxy.generateURL("avatars/me.png");

		expect(url).toBe("https://cdn.example.com/avatars/me.png");
	});

	test("generateURL trims trailing slash on publicUrl", async () => {
		const config = createMockConfig();
		const proxy = makeProxyUrlBuilder(config, {
			publicUrl: "https://cdn.example.com/",
		});

		const url = await proxy.generateURL("a.png");

		expect(url).toBe("https://cdn.example.com/a.png");
	});

	test("generateURL respects basePath", async () => {
		const config = createMockConfig({
			storage: { basePath: "/api" },
		});
		const proxy = makeProxyUrlBuilder(config);

		const url = await proxy.generateURL("a.png");

		expect(url).toBe("http://localhost:3000/api/storage/files/a.png");
	});

	test("generateSignedURL returns proxy URL with valid token", async () => {
		const config = createMockConfig();
		const proxy = makeProxyUrlBuilder(config);

		const url = await proxy.generateSignedURL("secret.pdf");

		expect(url).toContain("http://localhost:3000/storage/files/secret.pdf");
		expect(url).toContain("?token=");

		const token = new URL(url).searchParams.get("token");
		expect(token).toBeTruthy();

		const payload = await verifySignedUrlToken(token!, "test-secret");
		expect(payload).not.toBeNull();
		expect(payload?.key).toBe("secret.pdf");
	});

	test("generateSignedURL ALWAYS uses proxy even when publicUrl is set", async () => {
		const config = createMockConfig();
		const proxy = makeProxyUrlBuilder(config, {
			publicUrl: "https://cdn.example.com",
		});

		const url = await proxy.generateSignedURL("secret.pdf");

		// publicUrl is for public files only — signed URLs go through the proxy
		// so visibility-aware access control stays in effect.
		expect(url).toContain("http://localhost:3000/storage/files/");
		expect(url).not.toContain("cdn.example.com");
		expect(url).toContain("?token=");
	});

	test("generateSignedURL converts flydrive expiresIn (ms) to seconds", async () => {
		const config = createMockConfig();
		const proxy = makeProxyUrlBuilder(config);

		// flydrive passes expiresIn in milliseconds; we verify the resulting token
		// has the expected expiration (60s = 60000ms).
		const url = await proxy.generateSignedURL("a.pdf", 60_000);
		const token = new URL(url).searchParams.get("token")!;

		const payload = await verifySignedUrlToken(token, "test-secret");
		expect(payload).not.toBeNull();
		const now = Math.floor(Date.now() / 1000);
		// Allow a few seconds of clock skew.
		expect(payload!.expires - now).toBeGreaterThanOrEqual(55);
		expect(payload!.expires - now).toBeLessThanOrEqual(65);
	});

	test("generateSignedURL falls back to default expiration on bad input", async () => {
		const config = createMockConfig({
			storage: { signedUrlExpiration: 7200 },
		});
		const proxy = makeProxyUrlBuilder(config);

		const url = await proxy.generateSignedURL("a.pdf", "not-a-number");
		const token = new URL(url).searchParams.get("token")!;

		const payload = await verifySignedUrlToken(token, "test-secret");
		const now = Math.floor(Date.now() / 1000);
		expect(payload!.expires - now).toBeGreaterThan(7000);
	});
});

describe("R2Driver", () => {
	test("returns a StorageDriverFactory (not a DriverContract)", () => {
		const factory = R2Driver({
			bucket: "my-bucket",
			endpoint: "https://r2.example.com",
			credentials: { accessKeyId: "x", secretAccessKey: "y" },
			visibility: "public",
		});

		expect(typeof factory).toBe("function");
	});

	test("produces a flydrive driver with R2 conventions applied", () => {
		const factory = R2Driver({
			bucket: "my-bucket",
			endpoint: "https://r2.example.com",
			credentials: { accessKeyId: "x", secretAccessKey: "y" },
			visibility: "public",
		});
		const config = createMockConfig();
		const driver = factory(config);

		// We can't introspect S3Driver's constructor args directly, but we can
		// verify the resulting driver exposes the standard contract.
		expect(typeof driver.getUrl).toBe("function");
		expect(typeof driver.getSignedUrl).toBe("function");
		expect(typeof driver.put).toBe("function");

		// And that the options object on the driver carries the conventions.
		const opts = (driver as unknown as { options: Record<string, unknown> })
			.options;
		expect(opts.region).toBe("auto");
		expect(opts.forcePathStyle).toBe(true);
		expect(opts.supportsACL).toBe(false);
	});

	test("getUrl returns proxy URL by default", async () => {
		const factory = R2Driver({
			bucket: "my-bucket",
			endpoint: "https://r2.example.com",
			credentials: { accessKeyId: "x", secretAccessKey: "y" },
			visibility: "public",
		});
		const driver = factory(createMockConfig());

		const url = await driver.getUrl("photos/a.jpg");

		expect(url).toBe("http://localhost:3000/storage/files/photos%2Fa.jpg");
	});

	test("getUrl returns publicUrl/<key> when publicUrl is set", async () => {
		const factory = R2Driver({
			bucket: "my-bucket",
			endpoint: "https://r2.example.com",
			credentials: { accessKeyId: "x", secretAccessKey: "y" },
			visibility: "public",
			publicUrl: "https://pub-abc123.r2.dev",
		});
		const driver = factory(createMockConfig());

		const url = await driver.getUrl("photos/a.jpg");

		expect(url).toBe("https://pub-abc123.r2.dev/photos/a.jpg");
	});

	test("getSignedUrl uses proxy + token even when publicUrl is set", async () => {
		const factory = R2Driver({
			bucket: "my-bucket",
			endpoint: "https://r2.example.com",
			credentials: { accessKeyId: "x", secretAccessKey: "y" },
			visibility: "private",
			publicUrl: "https://pub-abc123.r2.dev",
		});
		const driver = factory(createMockConfig());

		const url = await driver.getSignedUrl("private.pdf");

		expect(url).toContain("http://localhost:3000/storage/files/private.pdf");
		expect(url).not.toContain("r2.dev");
		expect(url).toContain("?token=");
	});

	test("user-supplied urlBuilder overrides override the proxy defaults", async () => {
		const factory = R2Driver({
			bucket: "my-bucket",
			endpoint: "https://r2.example.com",
			credentials: { accessKeyId: "x", secretAccessKey: "y" },
			visibility: "public",
			urlBuilder: {
				generateURL: async (key) => `https://manual.example.com/${key}`,
			},
		});
		const driver = factory(createMockConfig());

		const url = await driver.getUrl("a.png");

		expect(url).toBe("https://manual.example.com/a.png");
	});
});

describe("createDiskDriver — driver factory variant", () => {
	test("invokes factory function with config", () => {
		const factory = R2Driver({
			bucket: "my-bucket",
			endpoint: "https://r2.example.com",
			credentials: { accessKeyId: "x", secretAccessKey: "y" },
			visibility: "public",
		});
		const config = createMockConfig({ storage: { driver: factory } });

		const driver = createDiskDriver(config);

		expect(typeof driver.put).toBe("function");
		expect(typeof driver.getUrl).toBe("function");
	});

	test("backwards-compat: still accepts a raw DriverContract", () => {
		const mockDriver = {
			put: () => {},
			get: () => {},
			delete: () => {},
			exists: () => {},
			getUrl: () => {},
			getSignedUrl: () => {},
		} as any;
		const config = createMockConfig({ storage: { driver: mockDriver } });

		const driver = createDiskDriver(config);

		expect(driver).toBe(mockDriver);
	});
});
