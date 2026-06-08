import { afterEach, describe, expect, test } from "bun:test";

import { resolveAssetUrl } from "../../src/client/utils/asset-url";

const originalWindow = globalThis.window;

function setWindowOrigin(origin: string) {
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: { location: { origin } },
	});
}

afterEach(() => {
	Object.defineProperty(globalThis, "window", {
		configurable: true,
		value: originalWindow,
	});
});

describe("resolveAssetUrl", () => {
	test("renders same-origin QUESTPIE storage URLs as relative paths", () => {
		setWindowOrigin("http://localhost:3000");

		expect(
			resolveAssetUrl(
				"http://localhost:3000/api/assets/files/107895c7-069e-4c48-92b5-b2e7b0d4a50e",
			),
		).toBe("/api/assets/files/107895c7-069e-4c48-92b5-b2e7b0d4a50e");
	});

	test("preserves signed storage URL query strings for same-origin URLs", () => {
		setWindowOrigin("http://localhost:3000");

		expect(
			resolveAssetUrl(
				"http://localhost:3000/api/assets/files/private.png?token=abc#preview",
			),
		).toBe("/api/assets/files/private.png?token=abc#preview");
	});

	test("does not rewrite external CDN URLs", () => {
		setWindowOrigin("http://localhost:3001");

		expect(resolveAssetUrl("https://cdn.example.com/images/photo.png")).toBe(
			"https://cdn.example.com/images/photo.png",
		);
	});

	test("keeps cross-origin QUESTPIE storage URLs absolute", () => {
		setWindowOrigin("http://localhost:5000");

		expect(
			resolveAssetUrl(
				"http://localhost:3000/api/assets/files/107895c7-069e-4c48-92b5-b2e7b0d4a50e",
			),
		).toBe(
			"http://localhost:3000/api/assets/files/107895c7-069e-4c48-92b5-b2e7b0d4a50e",
		);
	});
});
