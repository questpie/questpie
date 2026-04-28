/**
 * Integration test: collection .upload() + R2Driver from `questpie/storage`.
 *
 * Verifies the asset.url field that the upload afterRead hook attaches via
 * `app.storage.use().getUrl(key)` / `getSignedUrl(key)` resolves to the
 * questpie storage proxy URL when an R2-backed driver is configured — without
 * the user having to write a urlBuilder override by hand.
 *
 * S3/R2 itself is never hit: the upload afterRead hook only exercises the
 * driver's urlBuilder, which is pure (no network).
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { Questpie } from "../../src/server/config/questpie.js";
import { R2Driver } from "../../src/server/modules/core/integrated/storage/drivers/r2.js";
import { verifySignedUrlToken } from "../../src/server/modules/core/integrated/storage/signed-url.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const assets = collection("assets")
	.options({ timestamps: true })
	.fields(({ f }) => ({ alt: f.text(500) }))
	.upload({ visibility: "public" });

const SECRET = "r2-test-secret";

const r2Options = {
	bucket: "questpie-test",
	endpoint: "https://example.r2.cloudflarestorage.com",
	credentials: { accessKeyId: "x", secretAccessKey: "y" },
	visibility: "public" as const,
};

describe("R2Driver integration: collection asset.url", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;
	let app: (typeof setup)["app"];
	const ctx = createTestContext();

	const baseUrl = "http://app.test";

	const setupApp = async (driver: ReturnType<typeof R2Driver>) => {
		setup = await buildMockApp(
			{ collections: { assets } },
			{
				app: { url: baseUrl },
				secret: SECRET,
				storage: { driver },
			},
		);
		app = setup.app;
		await runTestDbMigrations(app);
		// buildMockApp calls `app.storage.fake()` automatically — restore so the
		// real R2-backed driver's urlBuilder runs.
		app.storage.restore(Questpie.__internal.storageDriverServiceName);
	};

	afterEach(async () => {
		await setup.cleanup();
	});

	describe("default (no publicUrl)", () => {
		beforeEach(async () => {
			await setupApp(R2Driver(r2Options));
		});

		it("public asset.url is the questpie proxy URL", async () => {
			const asset = await app.collections.assets.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/public.png",
					filename: "public.png",
					mimeType: "image/png",
					size: 1234,
					visibility: "public",
				},
				ctx,
			);

			const fetched = await app.collections.assets.findOne(
				{ where: { id: asset.id } },
				ctx,
			);

			const url = (fetched as any).url as string;
			expect(url).toBe(`${baseUrl}/storage/files/uploads%2Fpublic.png`);
			expect(url).not.toContain("?token=");
		});

		it("private asset.url has ?token= and verifies", async () => {
			const asset = await app.collections.assets.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/private.pdf",
					filename: "private.pdf",
					mimeType: "application/pdf",
					size: 999,
					visibility: "private",
				},
				ctx,
			);

			const fetched = await app.collections.assets.findOne(
				{ where: { id: asset.id } },
				ctx,
			);

			const url = (fetched as any).url as string;
			expect(url).toStartWith(`${baseUrl}/storage/files/uploads%2Fprivate.pdf`);
			expect(url).toContain("?token=");

			const token = new URL(url).searchParams.get("token")!;
			const payload = await verifySignedUrlToken(token, SECRET);
			expect(payload).not.toBeNull();
			expect(payload?.key).toBe("uploads/private.pdf");
		});
	});

	describe("with publicUrl override", () => {
		const publicUrl = "https://cdn.example.com";

		beforeEach(async () => {
			await setupApp(R2Driver({ ...r2Options, publicUrl }));
		});

		it("public asset.url is `${publicUrl}/${key}`", async () => {
			const asset = await app.collections.assets.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/public.png",
					filename: "public.png",
					mimeType: "image/png",
					size: 1234,
					visibility: "public",
				},
				ctx,
			);

			const fetched = await app.collections.assets.findOne(
				{ where: { id: asset.id } },
				ctx,
			);

			const url = (fetched as any).url as string;
			expect(url).toBe(`${publicUrl}/uploads/public.png`);
		});

		it("private asset.url still goes through the proxy", async () => {
			const asset = await app.collections.assets.create(
				{
					id: crypto.randomUUID(),
					key: "uploads/secret.pdf",
					filename: "secret.pdf",
					mimeType: "application/pdf",
					size: 999,
					visibility: "private",
				},
				ctx,
			);

			const fetched = await app.collections.assets.findOne(
				{ where: { id: asset.id } },
				ctx,
			);

			const url = (fetched as any).url as string;
			// Public override does NOT bypass the access-control proxy for private.
			expect(url).toStartWith(`${baseUrl}/storage/files/uploads%2Fsecret.pdf`);
			expect(url).not.toContain("cdn.example.com");
			expect(url).toContain("?token=");
		});
	});
});
