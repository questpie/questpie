/**
 * QUE-260: Namespace + lifecycle projection tests
 *
 * Verifies:
 * 1. Scoped services with namespace: null are allowed
 * 2. Scoped services with custom namespaces are rejected
 * 3. extractAppServices includes scoped null-namespace services at top level
 * 4. Singleton null-namespace services work as before
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collection, service } from "../../../src/exports/index.js";
import { extractAppServices } from "../../../src/server/config/app-context.js";
import { buildMockApp } from "../../utils/mocks/mock-app-builder";
import { createTestContext } from "../../utils/test-context";
import { runTestDbMigrations } from "../../utils/test-db";

describe("Namespace + Lifecycle Projection (QUE-260)", () => {
	describe("constraint rules", () => {
		it("allows request-scoped + namespace: null", async () => {
			const setup = await buildMockApp({
				collections: {
					items: collection("items").fields(({ f }) => ({
						name: f.text(100).required(),
					})),
				},
				services: {
					requestLocale: service()
						.lifecycle("request")
						.namespace(null)
						.create(() => "en"),
				},
			});
			await runTestDbMigrations(setup.app);

			// Service should resolve
			const instance = setup.app.resolveService("requestLocale");
			expect(instance).toBe("en");

			await setup.cleanup();
		});

		it("allows request-scoped + namespace: services (default)", async () => {
			const setup = await buildMockApp({
				services: {
					tracker: service()
						.lifecycle("request")
						.create(() => ({ tracked: true })),
				},
			});

			const instance = setup.app.resolveService("tracker");
			expect(instance).toEqual({ tracked: true });

			await setup.cleanup();
		});

		it("rejects request-scoped + custom namespace", async () => {
			await expect(
				buildMockApp({
					services: {
						tracker: service()
							.lifecycle("request")
							.namespace("analytics")
							.create(() => ({ tracked: true })),
					},
				}),
			).rejects.toThrow("custom namespaces");
		});
	});

	describe("extractAppServices projection", () => {
		it("singleton null-namespace appears at top level", async () => {
			const setup = await buildMockApp({
				services: {
					myDb: service()
						.lifecycle("singleton")
						.namespace(null)
						.create(() => ({ type: "singleton-db" })),
				},
			});

			const ctx = extractAppServices(setup.app, {
				db: setup.app.db,
			});

			expect(ctx.myDb).toEqual({ type: "singleton-db" });

			await setup.cleanup();
		});

		it("request-scoped null-namespace appears at top level in ctx", async () => {
			const setup = await buildMockApp({
				services: {
					currentUser: service()
						.lifecycle("request")
						.namespace(null)
						.create(() => ({ name: "test-user" })),
				},
			});

			const ctx = extractAppServices(setup.app, {
				db: setup.app.db,
			});

			expect(ctx.currentUser).toEqual({ name: "test-user" });

			await setup.cleanup();
		});

		it("request-scoped services namespace goes to services bucket", async () => {
			const setup = await buildMockApp({
				services: {
					counter: service()
						.lifecycle("request")
						.create(() => ({ count: 0 })),
				},
			});

			const ctx = extractAppServices(setup.app, {
				db: setup.app.db,
			});

			expect((ctx.services as any).counter).toEqual({ count: 0 });

			await setup.cleanup();
		});

		it("scope memoizes request-scoped services", async () => {
			let callCount = 0;
			const setup = await buildMockApp({
				services: {
					counter: service()
						.lifecycle("request")
						.namespace(null)
						.create(() => ({ id: ++callCount })),
				},
			});

			const { RequestScope } = await import(
				"../../../src/server/config/request-scope.js"
			);
			const scope = new RequestScope();

			const ctx1 = extractAppServices(setup.app, {
				db: setup.app.db,
				scope,
			});
			const ctx2 = extractAppServices(setup.app, {
				db: setup.app.db,
				scope,
			});

			// Same scope → same instance
			expect(ctx1.counter).toBe(ctx2.counter);
			expect(callCount).toBe(1);

			await setup.cleanup();
		});
	});
});
