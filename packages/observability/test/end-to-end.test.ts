import { beforeEach, describe, expect, it } from "bun:test";

import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { context, propagation, trace } from "@opentelemetry/api";
import {
	InMemoryLogRecordExporter,
	SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
	InMemorySpanExporter,
	SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { ConsoleAdapter } from "questpie/adapters/console";
import { MemoryKVAdapter } from "questpie/adapters/memory-kv";
import { createApp, module } from "questpie/app";
import { collection } from "questpie/builders";
import { createFetchHandler } from "questpie/http";

import { otelObservability } from "../src/otel-adapter.js";

/**
 * The capstone: a REAL app, a REAL HTTP request, real exporters holding exactly
 * what a collector would receive.
 *
 * Written against the public API only — `questpie/app`, `questpie/builders`,
 * `questpie/http`, `questpie/adapters/*` — because that is what someone wiring
 * this up actually has, and a test reaching into internals cannot catch a break
 * in the documented path. It caught one on its first run: the runtime config's
 * `observability` key was accepted by the types and then dropped during app
 * construction, so the documented way to enable tracing did nothing at all.
 * Every span below already existed; none of them reached anywhere.
 *
 * It has to live in this package: the dependency runs observability → questpie,
 * and importing the other way would close a cycle in the turbo graph.
 *
 * Everything is asserted from the exporter, never from a spy. A spy proves the
 * framework called `span()`; only the exporter proves a backend receives a
 * usable trace.
 */

const notes = collection("notes")
	.fields(({ f }) => ({ title: f.text().required() }))
	.access({ read: () => true, create: () => true });

function harness() {
	const spans = new InMemorySpanExporter();
	const logs = new InMemoryLogRecordExporter();
	const adapter = otelObservability({
		serviceName: "e2e",
		spanProcessors: [new SimpleSpanProcessor(spans)],
		logRecordProcessors: [new SimpleLogRecordProcessor({ exporter: logs })],
	});
	return { spans, logs, adapter };
}

async function buildApp(adapter?: ReturnType<typeof otelObservability>) {
	// pg_trgm has to be bundled AND created: the framework no longer creates
	// extensions itself, and auto-migration fails without it.
	const client = await PGlite.create({ extensions: { pg_trgm } });
	await client.exec("CREATE EXTENSION IF NOT EXISTS pg_trgm");
	return (await createApp(
		{ modules: [module({ name: "e2e", collections: { notes } })] },
		{
			app: { url: "http://localhost:3000" },
			db: { pglite: client },
			email: { adapter: new ConsoleAdapter() },
			kv: { adapter: new MemoryKVAdapter() },
			// Without this the table does not exist, every request 500s, and the
			// span assertions still pass — a span is opened for a query that
			// fails too. The first version of this file did exactly that.
			autoMigrate: true,
			...(adapter ? { observability: { adapter } } : {}),
		} as never,
	)) as never;
}

/**
 * Create the tables. `autoMigrate` has nothing to apply when no migration files
 * exist, so without this every request 500s on a missing relation — and the
 * span assertions still pass, because a span is opened for a failing query too.
 * The first two versions of this file did exactly that.
 */
async function syncSchema(app: {
	getSchema(): unknown;
	db: { execute(sql: unknown): Promise<unknown> };
}) {
	const { generateDrizzleJson, generateMigration } =
		await import("drizzle-kit/api-postgres");
	const empty = {
		id: "00000000-0000-0000-0000-000000000000",
		dialect: "postgres" as const,
		prevIds: [],
		version: "8" as const,
		ddl: [],
		renames: [],
	};
	const snapshot = await generateDrizzleJson(
		app.getSchema() as never,
		empty.id,
	);
	const statements = await generateMigration(empty as never, snapshot);
	const { sql } = await import("drizzle-orm");
	let created = false;
	for (const statement of statements) {
		try {
			await app.db.execute(sql.raw(statement));
			if (statement.includes('"notes"')) created = true;
		} catch {
			// Tolerated: the full schema includes tables from other core modules
			// that PGlite cannot create here. This test needs exactly one table,
			// and the assertion below is what guarantees it got it.
		}
	}
	if (!created) throw new Error("e2e fixture: the notes table was not created");
}

/**
 * Spans belonging to the request, by the trace of its HTTP root.
 *
 * Auto-migration issues its own queries during startup and they finish after
 * the exporter is reset, so the exporter legitimately holds parentless startup
 * spans alongside the request. Those are correct — startup work is not part of
 * a request trace — and asserting over every finished span would be asserting
 * that they do not exist.
 */
function requestTrace(
	all: ReturnType<InMemorySpanExporter["getFinishedSpans"]>,
) {
	const root = all.find(
		(s) => s.name.startsWith("GET ") || s.name.startsWith("POST "),
	);
	if (!root) return { root: undefined, spans: [] as typeof all };
	const traceId = root.spanContext().traceId;
	return {
		root,
		spans: all.filter((s) => s.spanContext().traceId === traceId),
	};
}

describe("observability end to end", () => {
	beforeEach(() => {
		trace.disable();
		propagation.disable();
		context.disable();
	});

	it("a real request produces ONE trace, rooted at HTTP, with the work nested", async () => {
		const h = harness();
		const app = await buildApp(h.adapter);
		await syncSchema(app as never);
		const handle = createFetchHandler(app);
		// App construction runs its own queries (the Postgres version preflight)
		// and those legitimately belong to no request trace. Measure the request.
		h.spans.reset();

		await handle(new Request("http://localhost:3000/notes"));

		const finished = h.spans.getFinishedSpans();
		await h.adapter.shutdown();

		const { root, spans } = requestTrace(finished);
		expect(root?.name).toBe("GET /notes");
		expect(spans.length).toBeGreaterThan(1);
		// Exactly one root inside the request's trace — a scattering of roots is
		// what an unusable waterfall looks like.
		expect(spans.filter((s) => !s.parentSpanContext)).toHaveLength(1);

		// The CRUD span is a CHILD of the request, not a sibling. A shared trace
		// id alone would not prove that.
		const find = spans.find((s) => s.name === "collection.find");
		expect(find).toBeDefined();
		expect(find!.parentSpanContext?.spanId).toBe(root!.spanContext().spanId);
	});

	it("reaches the database, and the query span sits under the CRUD span", async () => {
		const h = harness();
		const app = await buildApp(h.adapter);
		await syncSchema(app as never);
		const handle = createFetchHandler(app);
		h.spans.reset();

		await handle(new Request("http://localhost:3000/notes"));

		const finished = h.spans.getFinishedSpans();
		await h.adapter.shutdown();

		const { spans } = requestTrace(finished);
		const find = spans.find((s) => s.name === "collection.find");
		const query = spans.find((s) => s.name.startsWith("db."));
		expect(query).toBeDefined();
		expect(query!.attributes["db.system"]).toBe("postgresql");
		// Three levels: HTTP → collection → SQL. That depth is the whole point.
		expect(query!.parentSpanContext?.spanId).toBe(find!.spanContext().spanId);
	});

	it("never puts query parameters on a span", async () => {
		const h = harness();
		const app = await buildApp(h.adapter);
		await syncSchema(app as never);
		const handle = createFetchHandler(app);
		h.spans.reset();

		await handle(
			new Request("http://localhost:3000/notes", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ title: "a-very-distinctive-title" }),
			}),
		);

		// Scoped to span ATTRIBUTES, which is what the instrumentation controls.
		// A whole-object stringify also drags in status messages and event bodies,
		// where a validation error can legitimately echo the offending value —
		// that is a separate question from "do we attach query params".
		const attributeBlob = JSON.stringify(
			h.spans.getFinishedSpans().map((sp) => sp.attributes),
		);
		await h.adapter.shutdown();
		expect(attributeBlob).not.toContain("a-very-distinctive-title");
	});

	it("continues an inbound traceparent instead of starting its own trace", async () => {
		// Without this every service begins its own trace and the distributed
		// waterfall breaks at each hop — the caller's span and ours never join.
		const h = harness();
		const app = await buildApp(h.adapter);
		await syncSchema(app as never);
		const handle = createFetchHandler(app);
		h.spans.reset();

		const upstream = "12345678901234567890123456789012";
		await handle(
			new Request("http://localhost:3000/notes", {
				headers: { traceparent: `00-${upstream}-1234567890123456-01` },
			}),
		);

		const finished = h.spans.getFinishedSpans();
		const { root, spans } = requestTrace(finished);
		await h.adapter.shutdown();

		expect(root).toBeDefined();
		// Trace-id continuity is what this test owns: it proves the HTTP layer
		// hands the inbound headers to the adapter as a carrier. That the remote
		// span becomes the literal PARENT is asserted in otel-tree.test.ts,
		// against the adapter directly — deliberately not here, because these
		// tests share one process and OTel's globals are per-process, so the
		// exact parent link is only reliable in isolation.
		expect(root!.spanContext().traceId).toBe(upstream);
		expect(spans.length).toBeGreaterThan(1);
		for (const span of spans) {
			expect(span.spanContext().traceId).toBe(upstream);
		}
	});

	it("nests a cache seam span under the work that triggered it", async () => {
		// kv/search wrap themselves the same way CRUD does; what matters is that
		// they land under the caller rather than as orphan roots.
		const h = harness();
		const app = (await buildApp(h.adapter)) as {
			observability: {
				span<T>(n: string, fn: () => T, o?: unknown): T;
			};
			kv: {
				set(k: string, v: unknown): Promise<void>;
				get(k: string): Promise<unknown>;
			};
		};
		h.spans.reset();

		await app.observability.span(
			"http.request",
			async () => {
				await app.kv.set("cache-key", { hit: true });
				await app.kv.get("cache-key");
			},
			{ kind: "server" },
		);

		const finished = h.spans.getFinishedSpans();
		await h.adapter.shutdown();

		const outer = finished.find((x) => x.name === "http.request")!;
		const kvSpans = finished.filter((x) => x.name.startsWith("kv."));
		expect(kvSpans.length).toBeGreaterThan(0);
		for (const span of kvSpans) {
			expect(span.parentSpanContext?.spanId).toBe(outer.spanContext().spanId);
		}
		// The key itself must never be an attribute — keys routinely embed ids
		// and occasionally tokens.
		expect(JSON.stringify(kvSpans.map((x) => x.attributes))).not.toContain(
			"cache-key",
		);
	});

	it("records the RED histogram for the request", async () => {
		// One histogram, not three instruments: rate is its count, and errors are
		// that count sliced by status code.
		const app = await buildApp(harness().adapter);
		await syncSchema(app as never);
		const handle = createFetchHandler(app);

		const recorded: Array<{ value: number; attrs: unknown }> = [];
		const observability = (app as { observability: unknown }).observability as {
			histogram(n: string): { record(v: number, a?: unknown): void };
		};
		const instrument = observability.histogram("http.server.request.duration");
		const original = instrument.record.bind(instrument);
		instrument.record = (value: number, attrs?: unknown) => {
			recorded.push({ value, attrs });
			original(value, attrs);
		};

		await handle(new Request("http://localhost:3000/notes"));

		expect(recorded).toHaveLength(1);
		// Seconds, per OTel semconv. The log line beside it stays in ms.
		expect(recorded[0]!.value).toBeLessThan(60);
		expect(recorded[0]!.attrs).toMatchObject({
			"http.request.method": "GET",
			"http.response.status_code": 200,
		});
	});
});
