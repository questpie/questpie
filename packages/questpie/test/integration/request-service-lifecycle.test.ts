import { afterEach, describe, expect, it } from "bun:test";

import { z } from "zod";

import { collection, job, route, service } from "../../src/exports/index.js";
import { createFetchHandler } from "../../src/server/adapters/http.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { runTestDbMigrations } from "../utils/test-db";

describe("request service lifecycle", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>> | undefined;

	afterEach(async () => {
		await setup?.cleanup();
	});

	it("reuses scoped dependencies across an HTTP request and disposes them in reverse order", async () => {
		let childCreated = 0;
		let parentCreated = 0;
		const disposed: string[] = [];
		const accessChildIds: number[] = [];

		const child = service()
			.lifecycle("request")
			.create(() => ({ id: ++childCreated }))
			.dispose(() => {
				disposed.push("child");
			});
		const parent = service()
			.lifecycle("request")
			.create(({ services }) => ({
				id: ++parentCreated,
				child: services.child as { id: number },
			}))
			.dispose(() => {
				disposed.push("parent");
			});
		const items = collection("items")
			.fields(({ f }) => ({ name: f.text(100).required() }))
			.access({
				read: ({ services }) => {
					accessChildIds.push((services.child as { id: number }).id);
					return true;
				},
			});
		const inspect = route()
			.get()
			.handler(async ({ collections, services }) => {
				await collections.items.find({});
				return {
					directChildId: (services.child as { id: number }).id,
					dependencyChildId: (services.parent as { child: { id: number } })
						.child.id,
				};
			});

		setup = await buildMockApp({
			collections: { items },
			routes: { inspect },
			services: { child, parent },
		});
		await runTestDbMigrations(setup.app);

		const response = await createFetchHandler(setup.app)(
			new Request("http://localhost/inspect"),
		);
		const body =
			response instanceof Response
				? await response.json()
				: (response as unknown);

		expect(body).toEqual({ directChildId: 1, dependencyChildId: 1 });
		expect(accessChildIds).toEqual([1]);
		expect(childCreated).toBe(1);
		expect(parentCreated).toBe(1);
		expect(disposed).toEqual(["parent", "child"]);
	});

	it("keeps request services alive until a streamed response closes", async () => {
		let disposed = 0;
		let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
		const encoder = new TextEncoder();
		const streamService = service()
			.lifecycle("request")
			.create(() => ({ active: true }))
			.dispose(() => {
				disposed++;
			});
		const stream = route()
			.get()
			.raw()
			.handler(({ services }) => {
				void services.streamService;
				return new Response(
					new ReadableStream<Uint8Array>({
						start(value) {
							controller = value;
						},
					}),
				);
			});

		setup = await buildMockApp({
			routes: { stream },
			services: { streamService },
		});
		const response = await createFetchHandler(setup.app)(
			new Request("http://localhost/stream"),
		);
		expect(response).toBeInstanceOf(Response);
		expect(disposed).toBe(0);

		controller!.enqueue(encoder.encode("done"));
		controller!.close();
		expect(await response!.text()).toBe("done");
		expect(disposed).toBe(1);
	});

	it("disposes request services when a streamed response is cancelled", async () => {
		let disposed = 0;
		const streamService = service()
			.lifecycle("request")
			.create(() => ({}))
			.dispose(() => {
				disposed++;
			});
		const stream = route()
			.get()
			.raw()
			.handler(({ services }) => {
				void services.streamService;
				return new Response(new ReadableStream({}));
			});

		setup = await buildMockApp({
			routes: { stream },
			services: { streamService },
		});
		const response = await createFetchHandler(setup.app)(
			new Request("http://localhost/stream"),
		);
		expect(disposed).toBe(0);
		await response!.body!.cancel();
		expect(disposed).toBe(1);
	});

	it("disposes request services when a handler fails", async () => {
		let disposed = 0;
		const requestService = service()
			.lifecycle("request")
			.create(() => ({}))
			.dispose(() => {
				disposed++;
			});
		const fail = route()
			.get()
			.handler(({ services }) => {
				void services.requestService;
				throw new Error("expected failure");
			});

		setup = await buildMockApp({
			routes: { fail },
			services: { requestService },
		});
		const response = await createFetchHandler(setup.app)(
			new Request("http://localhost/fail"),
		);
		expect(response).toBeInstanceOf(Response);
		await response!.arrayBuffer();
		expect(disposed).toBe(1);
	});

	it("owns one request scope for a top-level programmatic CRUD operation", async () => {
		let created = 0;
		let disposed = 0;
		const requestService = service()
			.lifecycle("request")
			.create(() => ({ id: ++created }))
			.dispose(() => {
				disposed++;
			});
		const items = collection("items")
			.fields(({ f }) => ({ name: f.text(100).required() }))
			.access({
				read: ({ services }) => {
					void services.requestService;
					return true;
				},
			})
			.hooks({
				afterRead: [
					({ services }) => {
						void services.requestService;
					},
				],
			});

		setup = await buildMockApp({
			collections: { items },
			services: { requestService },
		});
		await runTestDbMigrations(setup.app);
		await setup.app.collections.items.find({});

		expect(created).toBe(1);
		expect(disposed).toBe(1);
	});

	it("owns one request scope for each queue job attempt", async () => {
		let created = 0;
		let disposed = 0;
		const observed: number[] = [];
		const child = service()
			.lifecycle("request")
			.create(() => ({ id: ++created }))
			.dispose(() => {
				disposed++;
			});
		const parent = service()
			.lifecycle("request")
			.create(({ services }) => ({ child: services.child }));
		const inspectJob = job({
			name: "inspect-request-scope",
			schema: z.object({}),
			handler: ({ services }: any) => {
				observed.push(services.child.id, services.parent.child.id);
			},
		});

		setup = await buildMockApp({
			jobs: { inspectJob },
			services: { child, parent },
		});
		await runTestDbMigrations(setup.app);
		await (setup.app as any).queue.inspectJob.publish({});
		await (setup.app as any).queue.runOnce();

		expect(observed).toEqual([1, 1]);
		expect(created).toBe(1);
		expect(disposed).toBe(1);
	});
});
