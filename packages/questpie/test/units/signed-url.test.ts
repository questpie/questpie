/**
 * Tests for signed URL generation and verification
 */

import { describe, expect, test } from "bun:test";
import {
	buildStorageFileUrl,
	generateSignedUrlToken,
	verifySignedUrlToken,
} from "../../src/server/integrated/storage/signed-url.js";

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
			// Generate token that expires in -1 seconds (already expired)
			const token = await generateSignedUrlToken("test.jpg", testSecret, -1);

			const payload = await verifySignedUrlToken(token, testSecret);

			expect(payload).toBeNull();
		});

		test("returns null for tampered token (modified key)", async () => {
			const token = await generateSignedUrlToken("test.jpg", testSecret, 3600);

			// Decode, modify key, re-encode (without valid signature)
			const padded = token.replace(/-/g, "+").replace(/_/g, "/");
			const decoded = JSON.parse(atob(padded));
			decoded.key = "hacked.jpg"; // Change the key
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
		test("builds URL without token for public files", () => {
			const url = buildStorageFileUrl(
				"http://localhost:3000",
				"/",
				"test-file.jpg",
			);

			expect(url).toBe("http://localhost:3000/storage/files/test-file.jpg");
		});

		test("builds URL with token for private files", () => {
			const url = buildStorageFileUrl(
				"http://localhost:3000",
				"/",
				"secret.pdf",
				"my-token-123",
			);

			expect(url).toBe(
				"http://localhost:3000/storage/files/secret.pdf?token=my-token-123",
			);
		});

		test("encodes special characters in key", () => {
			const url = buildStorageFileUrl(
				"http://localhost:3000",
				"/",
				"file with spaces.jpg",
			);

			expect(url).toBe(
				"http://localhost:3000/storage/files/file%20with%20spaces.jpg",
			);
		});

		test("handles keys with slashes (subdirectories)", () => {
			const url = buildStorageFileUrl(
				"http://localhost:3000",
				"/",
				"uploads/2024/01/image.jpg",
			);

			expect(url).toBe(
				"http://localhost:3000/storage/files/uploads%2F2024%2F01%2Fimage.jpg",
			);
		});

		test("works with different base paths", () => {
			const url = buildStorageFileUrl(
				"https://api.example.com",
				"/api",
				"file.jpg",
			);

			expect(url).toBe("https://api.example.com/api/storage/files/file.jpg");
		});

		test("works with trailing slash in base URL", () => {
			const url = buildStorageFileUrl(
				"http://localhost:3000/",
				"/",
				"file.jpg",
			);

			expect(url).toBe("http://localhost:3000/storage/files/file.jpg");
		});
	});

	describe("end-to-end token flow", () => {
		test("generates and verifies token correctly", async () => {
			const key = "documents/secret-report.pdf";
			const expiration = 7200; // 2 hours

			// Generate token
			const token = await generateSignedUrlToken(key, testSecret, expiration);

			// Build URL
			const url = buildStorageFileUrl("http://localhost:3000", "/", key, token);

			// Extract token from URL
			const urlObj = new URL(url);
			const extractedToken = urlObj.searchParams.get("token");

			expect(extractedToken).toBe(token);

			// Verify extracted token
			const payload = await verifySignedUrlToken(extractedToken!, testSecret);

			expect(payload).not.toBeNull();
			expect(payload?.key).toBe(key);
		});
	});
});
