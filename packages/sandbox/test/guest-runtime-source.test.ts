import { describe, expect, it } from "bun:test";

import {
	bundleGuestRuntimeSource,
	guestRuntimeDataUrl,
} from "../src/guest-runtime-source.js";

describe("guest runtime source transport", () => {
	it("inlines trusted bindings without a host path or network import", () => {
		const bundled = bundleGuestRuntimeSource(
			'import { buildGuestBindings, callBrokeredFetch } from "./guest-bindings.ts";\nconst cap = __QP_HTTP_FETCH_BODY_CAP_BYTES__;\nexport default buildGuestBindings;',
			"export function buildGuestBindings() { return 'ready'; }",
			123,
		);
		const url = guestRuntimeDataUrl(bundled);
		const decoded = new TextDecoder().decode(
			Uint8Array.from(atob(url.split(",")[1]), (character) =>
				character.charCodeAt(0),
			),
		);

		expect(url).toStartWith("data:application/typescript;base64,");
		expect(decoded).toContain("function buildGuestBindings()");
		expect(decoded).not.toContain("./guest-bindings.ts");
		expect(decoded).toContain("const cap = 123");
		expect(decoded).not.toContain("__QP_HTTP_FETCH_BODY_CAP_BYTES__");
		expect(decoded).not.toContain("127.0.0.1");
		expect(decoded).not.toContain("file://");
	});

	it("fails closed when the qualified entry import changes", () => {
		expect(() =>
			bundleGuestRuntimeSource(
				'import { buildGuestBindings } from "https://host.invalid/module";\nconst cap = __QP_HTTP_FETCH_BODY_CAP_BYTES__;',
				"export function buildGuestBindings() {}",
				123,
			),
		).toThrow(/qualified bindings import/);
	});
});
