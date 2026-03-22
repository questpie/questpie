/**
 * QUE-255: RequestScope — per-request service memoization tests
 */
import { describe, expect, it } from "bun:test";

import { RequestScope } from "../../../src/server/config/request-scope.js";

describe("RequestScope (QUE-255)", () => {
	it("memoizes service within scope", () => {
		const scope = new RequestScope();
		let callCount = 0;
		const factory = () => {
			callCount++;
			return { id: callCount };
		};

		const first = scope.getOrCreate("svc", factory);
		const second = scope.getOrCreate("svc", factory);

		expect(first).toBe(second);
		expect(callCount).toBe(1);
	});

	it("different scopes get different instances", () => {
		let callCount = 0;
		const factory = () => ({ id: ++callCount });

		const scope1 = new RequestScope();
		const scope2 = new RequestScope();

		const a = scope1.getOrCreate("svc", factory);
		const b = scope2.getOrCreate("svc", factory);

		expect(a).not.toBe(b);
		expect(a.id).toBe(1);
		expect(b.id).toBe(2);
	});

	it("throws on async factory (must be pre-resolved)", () => {
		const scope = new RequestScope();

		expect(() => {
			scope.getOrCreate("async-svc", () => Promise.resolve("nope") as any);
		}).toThrow("returned a Promise from sync resolution");
	});

	it("pre-populated async services work via set()", () => {
		const scope = new RequestScope();
		scope.set("async-svc", { preResolved: true });

		const result = scope.getOrCreate("async-svc", () => {
			throw new Error("should not be called");
		});
		expect(result).toEqual({ preResolved: true });
	});

	it("throws after dispose", async () => {
		const scope = new RequestScope();
		scope.getOrCreate("svc", () => "hello");
		await scope.dispose();

		expect(() => {
			scope.getOrCreate("svc", () => "world");
		}).toThrow("disposed");
	});

	it("calls disposers in reverse order", async () => {
		const scope = new RequestScope();
		const order: string[] = [];

		scope.getOrCreate("a", () => "instanceA");
		scope.getOrCreate("b", () => "instanceB");
		scope.getOrCreate("c", () => "instanceC");

		const disposers = new Map<string, (i: unknown) => void>();
		disposers.set("a", () => { order.push("a"); });
		disposers.set("b", () => { order.push("b"); });
		disposers.set("c", () => { order.push("c"); });

		await scope.dispose(disposers);

		expect(order).toEqual(["c", "b", "a"]);
	});

	it("has() and get() work correctly", () => {
		const scope = new RequestScope();

		expect(scope.has("svc")).toBe(false);
		expect(scope.get("svc")).toBeUndefined();

		scope.set("svc", 42);

		expect(scope.has("svc")).toBe(true);
		expect(scope.get("svc")).toBe(42);
	});
});
