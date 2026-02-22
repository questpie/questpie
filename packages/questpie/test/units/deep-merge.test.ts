import { describe, expect, test } from "bun:test";
import { deepMerge } from "../../src/shared/utils/data-utils.js";

describe("deepMerge", () => {
	describe("basic merging", () => {
		test("should merge two simple objects", () => {
			const target = { a: 1, b: 2 };
			const source = { c: 3, d: 4 };
			const result = deepMerge(target, source);

			expect(result).toEqual({ a: 1, b: 2, c: 3, d: 4 });
		});

		test("should override primitive values from target with source", () => {
			const target = { a: 1, b: 2 };
			const source = { b: 3, c: 4 };
			const result = deepMerge(target, source);

			expect(result).toEqual({ a: 1, b: 3, c: 4 });
		});

		test("should handle empty objects", () => {
			const target = { a: 1 };
			const source = {};
			const result = deepMerge(target, source);

			expect(result).toEqual({ a: 1 });
		});

		test("should handle empty target", () => {
			const target = {};
			const source = { a: 1, b: 2 };
			const result = deepMerge(target, source);

			expect(result).toEqual({ a: 1, b: 2 });
		});
	});

	describe("nested object merging", () => {
		test("should merge nested objects recursively", () => {
			const target = {
				a: 1,
				b: {
					c: 2,
					d: 3,
				},
			};
			const source = {
				b: {
					d: 4,
					e: 5,
				},
				f: 6,
			};
			const result = deepMerge(target, source);

			expect(result).toEqual({
				a: 1,
				b: {
					c: 2,
					d: 4,
					e: 5,
				},
				f: 6,
			});
		});

		test("should handle deeply nested objects", () => {
			const target = {
				level1: {
					level2: {
						level3: {
							value: "old",
						},
					},
				},
			};
			const source = {
				level1: {
					level2: {
						level3: {
							value: "new",
							additional: "data",
						},
					},
				},
			};
			const result = deepMerge(target, source);

			expect(result).toEqual({
				level1: {
					level2: {
						level3: {
							value: "new",
							additional: "data",
						},
					},
				},
			});
		});

		test("should merge multiple nested levels independently", () => {
			const target = {
				users: {
					admin: { role: "admin", permissions: ["read"] },
					user: { role: "user", permissions: ["read"] },
				},
			};
			const source = {
				users: {
					admin: { permissions: ["read", "write", "delete"] },
					moderator: { role: "moderator", permissions: ["read", "write"] },
				},
			};
			const result = deepMerge(target, source);

			expect(result).toEqual({
				users: {
					admin: { role: "admin", permissions: ["read", "write", "delete"] },
					user: { role: "user", permissions: ["read"] },
					moderator: { role: "moderator", permissions: ["read", "write"] },
				},
			});
		});
	});

	describe("array handling", () => {
		test("should replace arrays instead of merging them", () => {
			const target = { arr: [1, 2, 3] };
			const source = { arr: [4, 5] };
			const result = deepMerge(target, source);

			expect(result).toEqual({ arr: [4, 5] });
		});

		test("should handle arrays in nested objects", () => {
			const target = {
				data: {
					items: [1, 2, 3],
					count: 3,
				},
			};
			const source = {
				data: {
					items: [4, 5, 6, 7],
				},
			};
			const result = deepMerge(target, source);

			expect(result).toEqual({
				data: {
					items: [4, 5, 6, 7],
					count: 3,
				},
			});
		});

		test("should handle arrays with objects", () => {
			const target = { arr: [{ id: 1 }, { id: 2 }] };
			const source = { arr: [{ id: 3 }] };
			const result = deepMerge(target, source);

			expect(result).toEqual({ arr: [{ id: 3 }] });
		});
	});

	describe("nullish value handling", () => {
		test("should skip undefined source values", () => {
			const target = { a: 1, b: 2 };
			const source = { b: undefined, c: 3 };
			const result = deepMerge(target, source);

			expect(result).toEqual({ a: 1, b: 2, c: 3 });
		});

		test("should skip null source values", () => {
			const target = { a: 1, b: 2 };
			const source = { b: null, c: 3 };
			const result = deepMerge(target, source);

			expect(result).toEqual({ a: 1, b: 2, c: 3 });
		});

		test("should skip nullish source objects entirely", () => {
			const target = { a: 1 };
			const result = deepMerge(target, null, undefined, { b: 2 });

			expect(result).toEqual({ a: 1, b: 2 });
		});

		test("should handle null target values being overridden", () => {
			const target = { a: null, b: 2 };
			const source = { a: 1 };
			const result = deepMerge(target, source);

			expect(result).toEqual({ a: 1, b: 2 });
		});

		test("should handle undefined target values being overridden", () => {
			const target = { a: undefined, b: 2 };
			const source = { a: 1 };
			const result = deepMerge(target, source);

			expect(result).toEqual({ a: 1, b: 2 });
		});
	});

	describe("multiple sources", () => {
		test("should merge multiple sources in order", () => {
			const target = { a: 1 };
			const source1 = { b: 2 };
			const source2 = { c: 3 };
			const source3 = { d: 4 };
			const result = deepMerge(target, source1, source2, source3);

			expect(result).toEqual({ a: 1, b: 2, c: 3, d: 4 });
		});

		test("should override values in order from left to right", () => {
			const target = { a: 1, b: 1 };
			const source1 = { b: 2, c: 2 };
			const source2 = { c: 3, d: 3 };
			const result = deepMerge(target, source1, source2);

			expect(result).toEqual({ a: 1, b: 2, c: 3, d: 3 });
		});

		test("should handle nested merging with multiple sources", () => {
			const target = { config: { a: 1, b: 2 } };
			const source1 = { config: { b: 3, c: 4 } };
			const source2 = { config: { c: 5, d: 6 } };
			const result = deepMerge(target, source1, source2);

			expect(result).toEqual({
				config: { a: 1, b: 3, c: 5, d: 6 },
			});
		});
	});

	describe("special object types", () => {
		test("should replace Date objects instead of merging", () => {
			const date1 = new Date("2024-01-01");
			const date2 = new Date("2024-12-31");
			const target = { timestamp: date1 };
			const source = { timestamp: date2 };
			const result = deepMerge(target, source);

			expect(result.timestamp).toEqual(date2);
			expect(result.timestamp).not.toBe(date2); // Should be cloned
		});

		test("should replace RegExp objects instead of merging", () => {
			const target = { pattern: /abc/ };
			const source = { pattern: /xyz/i };
			const result = deepMerge(target, source);

			expect(result.pattern).toEqual(/xyz/i);
			expect(result.pattern).not.toBe(source.pattern); // Should be cloned
		});

		test("should replace Map objects instead of merging", () => {
			const map1 = new Map([["a", 1]]);
			const map2 = new Map([["b", 2]]);
			const target = { map: map1 };
			const source = { map: map2 };
			const result = deepMerge(target, source);

			expect(result.map).toEqual(map2);
			expect(result.map).not.toBe(map2); // Should be cloned
		});

		test("should replace Set objects instead of merging", () => {
			const set1 = new Set([1, 2, 3]);
			const set2 = new Set([4, 5, 6]);
			const target = { set: set1 };
			const source = { set: set2 };
			const result = deepMerge(target, source);

			expect(result.set).toEqual(set2);
			expect(result.set).not.toBe(set2); // Should be cloned
		});
	});

	describe("immutability", () => {
		test("should not mutate the target object", () => {
			const target = { a: 1, b: { c: 2 } };
			const source = { b: { d: 3 } };
			const targetCopy = structuredClone(target);

			deepMerge(target, source);

			expect(target).toEqual(targetCopy);
		});

		test("should not mutate source objects", () => {
			const target = { a: 1 };
			const source = { b: { c: 2 } };
			const sourceCopy = structuredClone(source);

			deepMerge(target, source);

			expect(source).toEqual(sourceCopy);
		});

		test("should return a new object reference", () => {
			const target = { a: 1 };
			const source = { b: 2 };
			const result = deepMerge(target, source);

			expect(result).not.toBe(target);
		});

		test("should create deep clones of nested objects", () => {
			const target = { a: { b: 1 } };
			const source = { c: { d: 2 } };
			const result = deepMerge(target, source);

			expect(result.a).not.toBe(target.a);
			expect(result.c).not.toBe(source.c);
		});

		test("should not share references between result and inputs", () => {
			const sharedObj = { value: 1 };
			const target = { obj: sharedObj };
			const result = deepMerge(target, {});

			result.obj.value = 999;

			expect(sharedObj.value).toBe(1); // Original should be unchanged
		});
	});

	describe("edge cases", () => {
		test("should handle no sources provided", () => {
			const target = { a: 1, b: { c: 2 } };
			const result = deepMerge(target);

			expect(result).toEqual(target);
			expect(result).not.toBe(target); // Should still clone
		});

		test("should handle mixing primitives and objects for the same key", () => {
			const target = { a: { b: 1 } };
			const source = { a: 42 };
			const result = deepMerge(target, source);

			expect(result).toEqual({ a: 42 });
		});

		test("should handle object replacing primitive", () => {
			const target = { a: 1 };
			const source = { a: { b: 2 } };
			const result = deepMerge(target, source);

			expect(result).toEqual({ a: { b: 2 } });
		});

		test("should handle complex real-world scenario", () => {
			const defaultConfig = {
				api: {
					endpoint: "https://api.example.com",
					timeout: 5000,
					retries: 3,
					headers: {
						"Content-Type": "application/json",
					},
				},
				features: {
					analytics: true,
					darkMode: false,
				},
				limits: [100, 200, 300],
			};

			const userConfig = {
				api: {
					endpoint: "https://custom-api.example.com",
					headers: {
						Authorization: "Bearer token",
						"X-Custom-Header": "value",
					},
				},
				features: {
					darkMode: true,
					betaFeatures: true,
				},
				limits: [50, 100],
			};

			const result = deepMerge(defaultConfig, userConfig);

			expect(result).toEqual({
				api: {
					endpoint: "https://custom-api.example.com",
					timeout: 5000,
					retries: 3,
					headers: {
						"Content-Type": "application/json",
						Authorization: "Bearer token",
						"X-Custom-Header": "value",
					},
				},
				features: {
					analytics: true,
					darkMode: true,
					betaFeatures: true,
				},
				limits: [50, 100],
			});
		});

		test("should handle symbols as keys (note: structuredClone limitation)", () => {
			const sym1 = Symbol("test1");
			const sym2 = Symbol("test2");
			const target = { [sym1]: "value1", a: 1 };
			const source = { [sym2]: "value2", b: 2 };
			const result = deepMerge(target, source);

			// Note: structuredClone does not preserve symbol properties
			// This is a known limitation - symbols are not cloned
			expect(result.a).toBe(1);
			expect(result.b).toBe(2);
		});

		test("should handle objects with null prototype", () => {
			const target = Object.create(null) as Record<string, unknown>;
			target.a = 1;
			const source = Object.create(null) as Record<string, unknown>;
			source.b = 2;
			const result = deepMerge({ wrapper: target }, { wrapper: source });

			expect(result.wrapper).toEqual({ a: 1, b: 2 });
		});

		test("should handle circular references gracefully", () => {
			const target: Record<string, unknown> = { a: 1 };
			target.self = target;

			// Bun's structuredClone handles circular references gracefully
			// (unlike some other runtimes where it throws)
			const result = deepMerge(target, { b: 2 });
			expect(result.a).toBe(1);
			expect(result.b).toBe(2);
			expect(result.self).toBe(result); // Circular reference preserved
		});

		test("should handle very deep nesting", () => {
			const createDeepObject = (depth: number, value: unknown): unknown => {
				if (depth === 0) return value;
				return { nested: createDeepObject(depth - 1, value) };
			};

			const target = createDeepObject(50, "old") as Record<string, unknown>;
			const source = createDeepObject(50, "new") as Record<string, unknown>;
			const result = deepMerge(target, source);

			let current = result;
			for (let i = 0; i < 50; i++) {
				current = current.nested as Record<string, unknown>;
			}
			expect(current).toBe("new");
		});
	});

	describe("type preservation", () => {
		test("should preserve boolean values", () => {
			const target = { flag: true };
			const source = { flag: false };
			const result = deepMerge(target, source);

			expect(result.flag).toBe(false);
		});

		test("should preserve number values including zero", () => {
			const target = { count: 10 };
			const source = { count: 0 };
			const result = deepMerge(target, source);

			expect(result.count).toBe(0);
		});

		test("should preserve empty strings", () => {
			const target = { text: "hello" };
			const source = { text: "" };
			const result = deepMerge(target, source);

			expect(result.text).toBe("");
		});

		test("should preserve NaN", () => {
			const target = { value: 42 };
			const source = { value: NaN };
			const result = deepMerge(target, source);

			expect(Number.isNaN(result.value)).toBe(true);
		});

		test("should preserve Infinity", () => {
			const target = { value: 42 };
			const source = { value: Infinity };
			const result = deepMerge(target, source);

			expect(result.value).toBe(Infinity);
		});
	});
});
