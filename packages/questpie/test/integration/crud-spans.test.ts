import { afterEach, describe, expect, it } from "bun:test";

import { collection } from "../../src/exports/index.js";
import { runWithContext } from "../../src/server/config/context.js";
import { ObservabilityService } from "../../src/server/modules/core/integrated/observability/service.js";
import type {
	ObservabilityAdapter,
	ObservabilityAttributeValue,
	ObservabilitySpan,
} from "../../src/server/modules/core/integrated/observability/types.js";
import { buildMockApp } from "../utils/mocks/mock-app-builder";
import { createTestContext } from "../utils/test-context";
import { runTestDbMigrations } from "../utils/test-db";

const posts = collection("posts").fields(({ f }) => ({
	title: f.text().required(),
}));

interface Recorded {
	name: string;
	attributes: Record<string, ObservabilityAttributeValue>;
	ended: boolean;
}

function recorder() {
	const spans: Recorded[] = [];
	const adapter: ObservabilityAdapter = {
		tracer: () => ({
			startActiveSpan(name, _options, fn) {
				const rec: Recorded = { name, attributes: {}, ended: false };
				spans.push(rec);
				const span: ObservabilitySpan = {
					setAttribute: (k, v) => {
						rec.attributes[k] = v;
					},
					setAttributes: (attrs) => {
						for (const [k, v] of Object.entries(attrs)) {
							if (v !== undefined) rec.attributes[k] = v;
						}
					},
					recordError: () => {},
					addEvent: () => {},
					end: () => {
						rec.ended = true;
					},
				};
				return fn(span);
			},
		}),
		meter: () => ({
			createCounter: () => ({ add: () => {} }),
			createHistogram: () => ({ record: () => {} }),
		}),
		shutdown: async () => {},
	};
	return { adapter, spans };
}

describe("CRUD spans", () => {
	let setup: Awaited<ReturnType<typeof buildMockApp>>;

	afterEach(async () => {
		await setup?.cleanup();
	});

	it("names a span per operation and tags the collection", async () => {
		const rec = recorder();
		setup = await buildMockApp({ collections: { posts } });
		setup.app.observability = new ObservabilityService({
			adapter: rec.adapter,
		});
		await runTestDbMigrations(setup.app);
		const ctx = createTestContext();

		// CRUD reads observability off the AMBIENT context, because a call can
		// come from HTTP, a job, a hook or a script and only the ambient context
		// knows which. Without runWithContext there is no app to read.
		await runWithContext({ app: setup.app, accessMode: "system" }, async () => {
			const created = await setup.app.collections.posts.create(
				{ title: "hello" },
				ctx,
			);
			await setup.app.collections.posts.findOne(
				{ where: { id: created.id } },
				ctx,
			);
			await setup.app.collections.posts.updateById(
				{ id: created.id, data: { title: "bye" } },
				ctx,
			);
			await setup.app.collections.posts.deleteById({ id: created.id }, ctx);
		});

		const names = rec.spans.map((s) => s.name);
		expect(names).toContain("collection.create");
		expect(names).toContain("collection.findOne");
		expect(names).toContain("collection.update");
		expect(names).toContain("collection.delete");
		expect(rec.spans.every((s) => s.ended)).toBe(true);
		expect(rec.spans[0]?.attributes["db.collection.name"]).toBe("posts");
	});

	it("stays a no-op outside an ambient context", async () => {
		const rec = recorder();
		setup = await buildMockApp({ collections: { posts } });
		setup.app.observability = new ObservabilityService({
			adapter: rec.adapter,
		});
		await runTestDbMigrations(setup.app);

		// No runWithContext: a direct script-style call still works, it simply
		// produces no spans rather than throwing.
		const created = await setup.app.collections.posts.create(
			{ title: "no ambient" },
			createTestContext(),
		);

		expect(created.title).toBe("no ambient");
		expect(rec.spans).toHaveLength(0);
	});
});
