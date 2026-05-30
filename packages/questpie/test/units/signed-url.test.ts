/**
 * Tests for signed URL generation and verification
 */

import { describe, expect, test } from "bun:test";

import {
	buildStorageFileUrl,
	generateSignedUrlToken,
	verifySignedUrlToken,
} from "../../src/server/modules/core/integrated/storage/signed-url.js";

describe("signed-url", () => {
	const testSecret = "test-secret-key-12345";

	describe("generateSignedUrlToken", () => {
		test("generates a token string", async () => {
			const token = await generateSignedUrlToken(
				"test-file.jpg",
				testSecret,
				3600,
			);

			expect(typeof token).toBe("string");
			expect(token.length).toBeGreaterThan(0);
		});

		test("generates different tokens for different keys", async () => {
			const token1 = await generateSignedUrlToken(
				"file1.jpg",
				testSecret,
				3600,
			);
			const token2 = await generateSignedUrlToken(
				"file2.jpg",
				testSecret,
				3600,
			);

			expect(token1).not.toBe(token2);
		});

		test("generates different tokens for different secrets", async () => {
			const token1 = await generateSignedUrlToken("test.jpg", "secret1", 3600);
			const token2 = await generateSignedUrlToken("test.jpg", "secret2", 3600);

			expect(token1).not.toBe(token2);
		});
	});

	describe("verifySignedUrlToken", () => {
		test("verifies a valid token", async () => {
			const key = "test-file.jpg";
			const token = await generateSignedUrlToken(key, testSecret, 3600);

			const payload = await verifySignedUrlToken(token, testSecret);

			expect(payload).not.toBeNull();
			expect(payload?.key).toBe(key);
			expect(payload?.expires).toBeGreaterThan(Math.floor(Date.now() / 1000));
		});

		test("binds tokens to a collection when expected", async () => {
			const token = await generateSignedUrlToken(
				"test-file.jpg",
				testSecret,
				3600,
				"media",
			);

			const payload = await verifySignedUrlToken(token, testSecret, "media");
			const reused = await verifySignedUrlToken(token, testSecret, "documents");

			expect(payload?.collection).toBe("media");
			expect(reused).toBeNull();
		});

		test("returns null for invalid token format", async () => {
			const payload = await verifySignedUrlToken("invalid-token", testSecret);

			expect(payload).toBeNull();
		});

		test("returns null for wrong secret", async () => {
			const token = await generateSignedUrlToken("test.jpg", testSecret, 3600);

			const payload = await verifySignedUrlToken(token, "wrong-secret");

			expect(payload).toBeNull();
		});

		test("returns null for expired token", async () => {
			const token = await generateSignedUrlToken("test.jpg", testSecret, -1);

			const payload = await verifySignedUrlToken(token, testSecret);

			expect(payload).toBeNull();
		});

		test("returns null for tampered token (modified key)", async () => {
			const token = await generateSignedUrlToken("test.jpg", testSecret, 3600);

			const padded = token.replace(/-/g, "+").replace(/_/g, "/");
			const decoded = JSON.parse(atob(padded));
			decoded.key = "hacked.jpg";
			const tamperedToken = btoa(JSON.stringify(decoded))
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/, "");

			const payload = await verifySignedUrlToken(tamperedToken, testSecret);

			expect(payload).toBeNull();
		});

		test("returns null for empty token", async () => {
			const payload = await verifySignedUrlToken("", testSecret);

			expect(payload).toBeNull();
		});
	});

	describe("buildStorageFileUrl", () => {
		test("builds collection URL without token for public files", () => {
			const url = buildStorageFileUrl(
				"http://localhost:3000",
				"/",
				"media",
				"test-file.jpg",
			);

			expect(url).toBe("http://localhost:3000/media/files/test-file.jpg");
		});

		test("builds collection URL with token for private files", () => {
			const url = buildStorageFileUrl(
				"http://localhost:3000",
				"/",
				"media",
				"secret.pdf",
				"my-token-123",
			);

			expect(url).toBe(
				"http://localhost:3000/media/files/secret.pdf?token=my-token-123",
			);
		});

		test("encodes special characters in key", () => {
			const url = buildStorageFileUrl(
				"http://localhost:3000",
				"/",
				"media",
				"file with spaces.jpg",
			);

			expect(url).toBe(
				"http://localhost:3000/media/files/file%20with%20spaces.jpg",
			);
		});

		test("handles keys with slashes (subdirectories)", () => {
			const url = buildStorageFileUrl(
				"http://localhost:3000",
				"/",
				"media",
				"uploads/2024/01/image.jpg",
			);

			expect(url).toBe(
				"http://localhost:3000/media/files/uploads%2F2024%2F01%2Fimage.jpg",
			);
		});

		test("works with different base paths", () => {
			const url = buildStorageFileUrl(
				"https://api.example.com",
				"/api",
				"media",
				"file.jpg",
			);

			expect(url).toBe("https://api.example.com/api/media/files/file.jpg");
		});

		test("works with trailing slash in base URL", () => {
			const url = buildStorageFileUrl(
				"http://localhost:3000/",
				"/",
				"media",
				"file.jpg",
			);

			expect(url).toBe("http://localhost:3000/media/files/file.jpg");
		});

		test("works with different collection names", () => {
			const url = buildStorageFileUrl(
				"http://localhost:3000",
				"/",
				"documents",
				"report.pdf",
			);

			expect(url).toBe("http://localhost:3000/documents/files/report.pdf");
		});
	});

	describe("end-to-end token flow", () => {
		test("generates and verifies token correctly", async () => {
			const key = "documents/secret-report.pdf";
			const expiration = 7200;

			const token = await generateSignedUrlToken(key, testSecret, expiration);

			const url = buildStorageFileUrl(
				"http://localhost:3000",
				"/",
				"media",
				key,
				token,
			);

			const urlObj = new URL(url);
			const extractedToken = urlObj.searchParams.get("token");

			expect(extractedToken).toBe(token);

			const payload = await verifySignedUrlToken(extractedToken!, testSecret);

			expect(payload).not.toBeNull();
			expect(payload?.key).toBe(key);
		});
	});
});
