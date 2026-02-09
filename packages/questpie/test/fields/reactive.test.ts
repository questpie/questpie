/**
 * Reactive Field System Tests
 *
 * Tests for proxy-based dependency tracking and reactive configuration utilities.
 *
 * IMPORTANT: Proxy-based tracking has limitations due to JavaScript's short-circuit evaluation:
 * - `&&` operators: Both sides are tracked because proxy returns truthy values
 * - `||` operators: Only the first (left) side is tracked because proxy is truthy
 * - Template literals: May track `.toString()` and `.valueOf()` calls
 *
 * Best practice for reliable dependency detection:
 * 1. Access all needed properties at the start of the handler
 * 2. Or use explicit `deps` array/function in the config
 */

import { describe, expect, test } from "bun:test";
import {
	extractDependencies,
	getDebounce,
	getHandler,
	isReactiveConfig,
	type ReactiveConfig,
	type ReactiveContext,
	trackDependencies,
	trackDepsFunction,
} from "#questpie/server/fields/reactive.js";

// ============================================================================
// trackDependencies Tests
// ============================================================================

describe("trackDependencies", () => {
	describe("basic property access", () => {
		test("should track single property access", () => {
			const { deps } = trackDependencies((ctx) => ctx.data.status);

			expect(deps).toContain("status");
			expect(deps).toHaveLength(1);
		});

		test("should track multiple property accesses (sequential)", () => {
			// Use sequential access instead of &&/|| to avoid short-circuit
			const { deps } = trackDependencies((ctx) => {
				const status = ctx.data.status;
				const type = ctx.data.type;
				return status === "draft" && type === "post";
			});

			expect(deps).toContain("status");
			expect(deps).toContain("type");
			expect(deps).toHaveLength(2);
		});

		test("should track property access in ternary (condition only)", () => {
			// Note: Due to short-circuit, only condition is guaranteed to be tracked
			const { deps } = trackDependencies((ctx) =>
				ctx.data.showAdvanced ? ctx.data.advancedValue : null,
			);

			expect(deps).toContain("showAdvanced");
			// advancedValue is tracked because proxy returns truthy value
			expect(deps).toContain("advancedValue");
		});

		test("should track property used in comparison", () => {
			const { deps } = trackDependencies((ctx) => ctx.data.count > 10);

			expect(deps).toContain("count");
		});

		test("should handle short-circuit AND - both sides tracked when proxy is truthy", () => {
			// Proxy always returns truthy (another proxy), so && continues
			const { deps } = trackDependencies(
				(ctx) => ctx.data.status && ctx.data.type,
			);

			expect(deps).toContain("status");
			expect(deps).toContain("type");
		});
	});

	describe("nested property access", () => {
		test("should track nested property access", () => {
			const { deps } = trackDependencies((ctx) => ctx.data.user.profile.name);

			expect(deps).toContain("user");
			expect(deps).toContain("user.profile");
			expect(deps).toContain("user.profile.name");
		});

		test("should track deeply nested properties", () => {
			const { deps } = trackDependencies(
				(ctx) => ctx.data.level1.level2.level3.level4.value,
			);

			expect(deps).toContain("level1");
			expect(deps).toContain("level1.level2");
			expect(deps).toContain("level1.level2.level3");
			expect(deps).toContain("level1.level2.level3.level4");
			expect(deps).toContain("level1.level2.level3.level4.value");
		});

		test("should handle multiple nested paths", () => {
			const { deps } = trackDependencies(
				(ctx) => ctx.data.user.name && ctx.data.settings.theme,
			);

			expect(deps).toContain("user");
			expect(deps).toContain("user.name");
			expect(deps).toContain("settings");
			expect(deps).toContain("settings.theme");
		});
	});

	describe("sibling tracking", () => {
		test("should track sibling property access with $sibling prefix", () => {
			const { deps } = trackDependencies((ctx) => ctx.sibling.country);

			expect(deps).toContain("$sibling.country");
		});

		test("should track multiple sibling properties", () => {
			const { deps } = trackDependencies(
				(ctx) => ctx.sibling.country && ctx.sibling.city,
			);

			expect(deps).toContain("$sibling.country");
			expect(deps).toContain("$sibling.city");
		});

		test("should track both data and sibling (sequential access)", () => {
			// Use sequential access to avoid short-circuit with ||
			const { deps } = trackDependencies((ctx) => {
				const dataCountry = ctx.data.country;
				const siblingCountry = ctx.sibling.country;
				return dataCountry || siblingCountry;
			});

			expect(deps).toContain("country");
			expect(deps).toContain("$sibling.country");
		});
	});

	describe("prev tracking", () => {
		test("should track prev.data with $prev prefix", () => {
			const { deps } = trackDependencies((ctx) => ctx.prev.data.status);

			expect(deps).toContain("$prev.status");
		});

		test("should track prev.sibling with $prev.$sibling prefix", () => {
			const { deps } = trackDependencies((ctx) => ctx.prev.sibling.product);

			expect(deps).toContain("$prev.$sibling.product");
		});

		test("should track change detection pattern", () => {
			const { deps } = trackDependencies(
				(ctx) => ctx.data.category !== ctx.prev.data.category,
			);

			expect(deps).toContain("category");
			expect(deps).toContain("$prev.category");
		});
	});

	describe("error handling", () => {
		test("should not throw on errors in handler", () => {
			const { deps } = trackDependencies((ctx) => {
				// Access property, then throw
				const _ = ctx.data.status;
				throw new Error("Test error");
			});

			// Should still capture the dependency before the error
			expect(deps).toContain("status");
		});

		test("should handle undefined return gracefully", () => {
			const { result, deps } = trackDependencies((ctx) => {
				const _ = ctx.data.field;
				return undefined;
			});

			expect(result).toBeUndefined();
			expect(deps).toContain("field");
		});
	});

	describe("special cases", () => {
		test("should ignore symbol properties", () => {
			const { deps } = trackDependencies((ctx) => {
				// Symbols should be filtered out
				const data = ctx.data as any;
				const _ = data[Symbol.toStringTag];
				return data.realField;
			});

			expect(deps).toContain("realField");
			expect(deps.some((d) => d.includes("Symbol"))).toBe(false);
		});

		test("should ignore 'then' property (Promise check)", () => {
			const { deps } = trackDependencies((ctx) => {
				const data = ctx.data as any;
				// This is what happens when something checks if it's a promise
				if (data.then) {
					return true;
				}
				return data.actualField;
			});

			expect(deps).not.toContain("then");
		});

		test("should deduplicate repeated accesses", () => {
			const { deps } = trackDependencies((ctx) => {
				const a = ctx.data.status;
				const b = ctx.data.status;
				const c = ctx.data.status;
				return a && b && c;
			});

			// Should only appear once
			const statusCount = deps.filter((d) => d === "status").length;
			expect(statusCount).toBe(1);
		});
	});
});

// ============================================================================
// trackDepsFunction Tests
// ============================================================================

describe("trackDepsFunction", () => {
	test("should track deps from array return", () => {
		const deps = trackDepsFunction((ctx) => [
			ctx.data.title,
			ctx.data.category,
		]);

		expect(deps).toContain("title");
		expect(deps).toContain("category");
	});

	test("should track deps from sibling access", () => {
		const deps = trackDepsFunction((ctx) => [
			ctx.data.country,
			ctx.sibling.country,
		]);

		expect(deps).toContain("country");
		expect(deps).toContain("$sibling.country");
	});

	test("should handle nested deps", () => {
		const deps = trackDepsFunction((ctx) => [
			ctx.data.user.name,
			ctx.data.settings.locale,
		]);

		expect(deps).toContain("user");
		expect(deps).toContain("user.name");
		expect(deps).toContain("settings");
		expect(deps).toContain("settings.locale");
	});
});

// ============================================================================
// extractDependencies Tests
// ============================================================================

describe("extractDependencies", () => {
	describe("short syntax (function)", () => {
		test("should extract deps from function handler", () => {
			const config: ReactiveConfig<boolean> = (ctx) =>
				ctx.data.status === "draft";

			const deps = extractDependencies(config);

			expect(deps).toContain("status");
		});

		test("should extract multiple deps from function", () => {
			// Note: Template literals cause toString/valueOf to be tracked
			// Use concatenation or explicit access instead
			const config: ReactiveConfig<string> = (ctx) => {
				const first = ctx.data.firstName;
				const last = ctx.data.lastName;
				return `${first} ${last}`;
			};

			const deps = extractDependencies(config);

			expect(deps).toContain("firstName");
			expect(deps).toContain("lastName");
		});
	});

	describe("full syntax (object with handler)", () => {
		test("should use explicit deps array", () => {
			const config: ReactiveConfig<boolean> = {
				handler: (ctx) => ctx.data.status === "draft",
				deps: ["status", "type"],
			};

			const deps = extractDependencies(config);

			expect(deps).toEqual(["status", "type"]);
		});

		test("should extract deps from deps function", () => {
			const config: ReactiveConfig<boolean> = {
				handler: (ctx) => ctx.data.status === "draft",
				deps: (ctx) => [ctx.data.status, ctx.data.type],
			};

			const deps = extractDependencies(config);

			expect(deps).toContain("status");
			expect(deps).toContain("type");
		});

		test("should fallback to handler tracking when no deps", () => {
			const config: ReactiveConfig<boolean> = {
				handler: (ctx) => ctx.data.showAdvanced && ctx.data.isAdmin,
			};

			const deps = extractDependencies(config);

			expect(deps).toContain("showAdvanced");
			expect(deps).toContain("isAdmin");
		});
	});
});

// ============================================================================
// getHandler Tests
// ============================================================================

describe("getHandler", () => {
	test("should return function directly for short syntax", () => {
		const fn = (ctx: ReactiveContext) => ctx.data.value;
		const config: ReactiveConfig<any> = fn;

		const handler = getHandler(config);

		expect(handler).toBe(fn);
	});

	test("should return handler property for full syntax", () => {
		const fn = (ctx: ReactiveContext) => ctx.data.value;
		const config: ReactiveConfig<any> = {
			handler: fn,
			deps: ["value"],
		};

		const handler = getHandler(config);

		expect(handler).toBe(fn);
	});
});

// ============================================================================
// getDebounce Tests
// ============================================================================

describe("getDebounce", () => {
	test("should return undefined for short syntax", () => {
		const config: ReactiveConfig<any> = (ctx) => ctx.data.value;

		const debounce = getDebounce(config);

		expect(debounce).toBeUndefined();
	});

	test("should return debounce value for full syntax", () => {
		const config: ReactiveConfig<any> = {
			handler: (ctx) => ctx.data.value,
			debounce: 300,
		};

		const debounce = getDebounce(config);

		expect(debounce).toBe(300);
	});

	test("should return undefined when debounce not set in full syntax", () => {
		const config: ReactiveConfig<any> = {
			handler: (ctx) => ctx.data.value,
		};

		const debounce = getDebounce(config);

		expect(debounce).toBeUndefined();
	});
});

// ============================================================================
// isReactiveConfig Tests
// ============================================================================

describe("isReactiveConfig", () => {
	test("should return true for function", () => {
		const config = (ctx: ReactiveContext) => ctx.data.value;

		expect(isReactiveConfig(config)).toBe(true);
	});

	test("should return true for object with handler", () => {
		const config = {
			handler: (ctx: ReactiveContext) => ctx.data.value,
		};

		expect(isReactiveConfig(config)).toBe(true);
	});

	test("should return false for static boolean", () => {
		expect(isReactiveConfig(true)).toBe(false);
		expect(isReactiveConfig(false)).toBe(false);
	});

	test("should return false for null/undefined", () => {
		expect(isReactiveConfig(null)).toBe(false);
		expect(isReactiveConfig(undefined)).toBe(false);
	});

	test("should return false for object without handler", () => {
		expect(isReactiveConfig({ deps: ["field"] })).toBe(false);
		expect(isReactiveConfig({ value: 123 })).toBe(false);
	});

	test("should return false for primitives", () => {
		expect(isReactiveConfig(123)).toBe(false);
		expect(isReactiveConfig("string")).toBe(false);
	});
});

// ============================================================================
// Real-world Use Cases
// ============================================================================

describe("real-world use cases", () => {
	test("auto-slug generation deps", () => {
		const config: ReactiveConfig<string> = {
			handler: (ctx) => {
				// Simulate slugify
				return ctx.data.title?.toLowerCase().replace(/\s+/g, "-");
			},
			deps: (ctx) => [ctx.data.title],
			debounce: 300,
		};

		const deps = extractDependencies(config);
		const debounce = getDebounce(config);

		expect(deps).toContain("title");
		expect(debounce).toBe(300);
	});

	test("cascading select deps (country -> city)", () => {
		const config: ReactiveConfig<null | undefined> = (ctx) => {
			// Reset city when country changes
			if (ctx.data.country !== ctx.prev.data.country) {
				return null;
			}
			return undefined; // No change
		};

		const deps = extractDependencies(config);

		expect(deps).toContain("country");
		expect(deps).toContain("$prev.country");
	});

	test("conditional visibility deps", () => {
		const config: ReactiveConfig<boolean> = (ctx) => {
			// Hide shipping fields for digital products
			return ctx.data.productType !== "physical";
		};

		const deps = extractDependencies(config);

		expect(deps).toContain("productType");
	});

	test("sibling-based variant filtering deps", () => {
		const config: ReactiveConfig<null | undefined> = (ctx) => {
			// Reset variant when product in same array item changes
			if (ctx.sibling.product !== ctx.prev.sibling?.product) {
				return null;
			}
			return undefined;
		};

		const deps = extractDependencies(config);

		expect(deps).toContain("$sibling.product");
		expect(deps).toContain("$prev.$sibling.product");
	});

	test("complex visibility with multiple conditions", () => {
		const config: ReactiveConfig<boolean> = (ctx) => {
			// Show analytics only for sent campaigns or past scheduled
			// Access all deps upfront to ensure tracking
			const status = ctx.data.status;
			const scheduledAt = ctx.data.scheduledAt;

			if (status === "sent") return false;
			if (status === "scheduled" && scheduledAt) {
				return new Date(scheduledAt as string) > new Date();
			}
			return true;
		};

		const deps = extractDependencies(config);

		expect(deps).toContain("status");
		expect(deps).toContain("scheduledAt");
	});
});
