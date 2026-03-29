/**
 * QUE-298: Route access control tests
 *
 * Tests that `evaluateRouteAccess` correctly enforces access rules,
 * covering boolean literals, callback functions, and the default (undefined) case.
 */
import { describe, expect, it } from "bun:test";

import { evaluateRouteAccess } from "../../src/server/routes/execute.js";

describe("evaluateRouteAccess", () => {
	// ── Boolean literals ────────────────────────────────────────────────

	it("returns true when access is undefined (default open)", async () => {
		expect(await evaluateRouteAccess(undefined, {})).toBe(true);
	});

	it("returns true when access is true", async () => {
		expect(await evaluateRouteAccess(true, {})).toBe(true);
	});

	it("returns false when access is false", async () => {
		expect(await evaluateRouteAccess(false, {})).toBe(false);
	});

	// ── Callback rules ──────────────────────────────────────────────────

	it("calls access function with context and returns its result", async () => {
		const rule = (ctx: any) => !!ctx.session;

		// No session → denied
		expect(await evaluateRouteAccess(rule, {})).toBe(false);
		expect(await evaluateRouteAccess(rule, { session: null })).toBe(false);

		// With session → allowed
		expect(await evaluateRouteAccess(rule, { session: { id: "u1" } })).toBe(
			true,
		);
	});

	it("returns false when access function throws", async () => {
		const rule = () => {
			throw new Error("boom");
		};
		expect(await evaluateRouteAccess(rule, {})).toBe(false);
	});

	it("supports async access functions", async () => {
		const rule = async (ctx: any) => {
			return ctx.session?.role === "admin";
		};

		expect(
			await evaluateRouteAccess(rule, { session: { role: "admin" } }),
		).toBe(true);
		expect(
			await evaluateRouteAccess(rule, { session: { role: "viewer" } }),
		).toBe(false);
	});

	// ── Object-form access ({ execute: rule }) ──────────────────────────

	it("extracts execute rule from object-form access", async () => {
		expect(await evaluateRouteAccess({ execute: true }, {})).toBe(true);
		expect(await evaluateRouteAccess({ execute: false }, {})).toBe(false);
	});

	it("defaults to allowed when object-form has undefined execute", async () => {
		expect(await evaluateRouteAccess({ execute: undefined }, {})).toBe(true);
	});

	it("evaluates function inside object-form access", async () => {
		const access = {
			execute: (ctx: any) => ctx.session !== null,
		};

		expect(await evaluateRouteAccess(access, { session: null })).toBe(false);
		expect(
			await evaluateRouteAccess(access, { session: { id: "u1" } }),
		).toBe(true);
	});
});
