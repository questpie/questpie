import { describe, expect, it } from "bun:test";

import { upload } from "../../src/server/modules/core/fields/upload.js";

/**
 * `mimeTypes` and `maxSize` were destructured out of the config and then
 * dropped, so every restriction written with them did nothing: the picker did
 * not filter and nothing else read them either. The starter's avatar field
 * gives the game away, passing `mimeTypes: ["image/*"]` and then repeating the
 * same intent as `.set("admin", { accept: "image/*" })`, which was the half
 * that worked.
 *
 * They now reach the admin control as its `accept` and `maxSize` props.
 */
describe("upload() carries its picker config", () => {
	it("turns mimeTypes into the control's accept", () => {
		const meta = (upload({ mimeTypes: ["image/*"] }) as any).getMetadata();

		expect(meta.meta.accept).toEqual(["image/*"]);
	});

	it("carries maxSize through", () => {
		const meta = (upload({ maxSize: 5_000_000 }) as any).getMetadata();

		expect(meta.meta.maxSize).toBe(5_000_000);
	});

	it("lets an explicit admin config win", () => {
		// `.set("admin", …)` is the more specific instruction, so it beats the
		// value derived from the field config rather than being merged with it.
		const meta = (
			upload({ mimeTypes: ["image/*"] }).set("admin", {
				accept: "application/pdf",
			}) as any
		).getMetadata();

		expect(meta.meta.accept).toBe("application/pdf");
	});

	it("adds nothing when neither is given", () => {
		const meta = (upload() as any).getMetadata();

		expect(meta.meta.accept).toBeUndefined();
		expect(meta.meta.maxSize).toBeUndefined();
	});

	it("survives .multiple()", () => {
		const meta = (
			(
				upload({ mimeTypes: ["image/*"], maxSize: 100 }) as any
			).multiple() as any
		).getMetadata();

		expect(meta.meta.accept).toEqual(["image/*"]);
		expect(meta.meta.maxSize).toBe(100);
	});
});
