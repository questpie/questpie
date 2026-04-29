import { describe, expect, it } from "bun:test";

import {
	attachInternalAdapterContext,
	getInternalAdapterContext,
	INTERNAL_ADAPTER_CONTEXT,
} from "../../src/server/config/internal-context.js";

describe("internal context store", () => {
	it("stores adapter context on a non-enumerable symbol key", () => {
		const store = { app: {} };
		const adapterContext = { appContext: { accessMode: "user" } };

		attachInternalAdapterContext(store, adapterContext);

		expect(getInternalAdapterContext(store)).toBe(adapterContext);
		expect(Object.keys(store)).toEqual(["app"]);
		expect(JSON.stringify(store)).toBe('{"app":{}}');
		expect(Object.getOwnPropertySymbols(store)).toEqual([
			INTERNAL_ADAPTER_CONTEXT,
		]);
	});

	it("is idempotent for the same adapter context", () => {
		const store = { app: {} };
		const adapterContext = { appContext: { accessMode: "user" } };

		attachInternalAdapterContext(store, adapterContext);
		attachInternalAdapterContext(store, adapterContext);

		expect(getInternalAdapterContext(store)).toBe(adapterContext);
	});

	it("rejects replacing an existing adapter context", () => {
		const store = { app: {} };
		attachInternalAdapterContext(store, { appContext: { accessMode: "user" } });

		expect(() =>
			attachInternalAdapterContext(store, {
				appContext: { accessMode: "system" },
			}),
		).toThrow("Internal adapter context is already attached");
	});

	it("returns undefined for non-object stores", () => {
		expect(getInternalAdapterContext(undefined)).toBeUndefined();
		expect(getInternalAdapterContext(null)).toBeUndefined();
		expect(getInternalAdapterContext("store")).toBeUndefined();
	});
});
