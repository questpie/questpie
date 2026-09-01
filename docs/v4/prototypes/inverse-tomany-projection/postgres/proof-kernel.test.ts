import { afterAll, beforeAll, expect, test } from "bun:test";

import pg from "pg";

import {
	assertChildOrderDisclosure,
	decodeInverseList,
	inverseListSql,
} from "./proof-kernel";

const client = new pg.Client({
	host: process.env.PGHOST,
	port: Number(process.env.PGPORT),
	database: process.env.PGDATABASE,
	user: process.env.PGUSER,
});

beforeAll(async () => {
	await client.connect();
	const version = await client.query("SHOW server_version_num");
	expect(version.rows[0]?.server_version_num).toMatch(/^17\d{4}$/);
	await client.query(`CREATE TEMPORARY TABLE "qp_inverse_tickets" (
    "id" text PRIMARY KEY,
    "tenant_id" text NOT NULL,
    "title" text NOT NULL,
    "authorized" boolean NOT NULL
  ) ON COMMIT PRESERVE ROWS`);
	await client.query(`CREATE TEMPORARY TABLE "qp_inverse_comments" (
    "id" text PRIMARY KEY,
    "ticket_id" text NOT NULL REFERENCES "qp_inverse_tickets" ("id"),
    "tenant_id" text NOT NULL,
    "body" text NOT NULL,
    "body_allowed" boolean NOT NULL,
    "authorized" boolean NOT NULL,
    "created_at" integer NOT NULL
  ) ON COMMIT PRESERVE ROWS`);
	await client.query(
		`INSERT INTO "qp_inverse_tickets" VALUES
      ('t1', 'tenant-a', 'first', TRUE),
      ('t2', 'tenant-a', 'second', TRUE),
      ('t3', 'tenant-a', 'sentinel', TRUE),
      ('tx', 'tenant-b', 'other tenant', TRUE)`,
	);
	await client.query(
		`INSERT INTO "qp_inverse_comments" VALUES
      ('hidden-newest', 't1', 'tenant-a', 'secret', TRUE, FALSE, 100),
      ('visible-redacted', 't1', 'tenant-a', 'redacted', FALSE, TRUE, 90),
      ('visible-second', 't1', 'tenant-a', 'second body', TRUE, TRUE, 80),
      ('visible-third', 't1', 'tenant-a', 'third body', TRUE, TRUE, 70),
      ('filtered', 't1', 'tenant-a', 'filtered', TRUE, TRUE, 110),
      ('only-hidden', 't2', 'tenant-a', 'hidden', TRUE, FALSE, 100),
      ('sentinel-child', 't3', 'tenant-a', 'discard me', TRUE, TRUE, 100),
      ('other-tenant', 't1', 'tenant-b', 'wrong tenant', TRUE, TRUE, 120)`,
	);
});

afterAll(async () => {
	await client.end();
});

test("one statement preserves Policy-before-limit, empty arrays, disclosure, and the root sentinel", async () => {
	assertChildOrderDisclosure({
		orderFields: ["createdAt", "id"],
		selectedFields: ["id", "body", "createdAt"],
		unconditionallyVisibleFields: ["id", "createdAt"],
	});
	await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
	try {
		const isolation = await client.query("SHOW transaction_isolation");
		const readOnly = await client.query("SHOW transaction_read_only");
		const result = await client.query(inverseListSql, ["tenant-a", null, 2, 2]);
		expect(isolation.rows[0]?.transaction_isolation).toBe("repeatable read");
		expect(readOnly.rows[0]?.transaction_read_only).toBe("on");
		expect(result.command).toBe("SELECT");
		expect(result.rowCount).toBe(4);
		expect(
			decodeInverseList(result.rows, {
				rootFirst: 2,
				childFirst: 2,
				resultBytes: 1_048_576,
			}),
		).toEqual({
			nodes: [
				{
					id: "t1",
					title: "first",
					comments: [
						{ id: "visible-redacted", createdAt: 90 },
						{
							id: "visible-second",
							body: "second body",
							createdAt: 80,
						},
					],
				},
				{ id: "t2", title: "second", comments: [] },
			],
			pageInfo: { hasNextPage: true },
		});
		await client.query("COMMIT");
	} catch (error) {
		await client.query("ROLLBACK");
		throw error;
	}
});

test("a conditional or unselected child order Field is refused before PostgreSQL", async () => {
	let dispatches = 0;
	const execute = async (
		input: Parameters<typeof assertChildOrderDisclosure>[0],
	) => {
		assertChildOrderDisclosure(input);
		dispatches += 1;
		return client.query(inverseListSql, ["tenant-a", null, 1, 1]);
	};
	await expect(
		execute({
			orderFields: ["body", "id"],
			selectedFields: ["body", "id"],
			unconditionallyVisibleFields: ["id", "createdAt"],
		}),
	).rejects.toThrow("QP-DATA-008 orderFieldNotSelected");
	await expect(
		execute({
			orderFields: ["createdAt", "id"],
			selectedFields: ["id"],
			unconditionallyVisibleFields: ["id", "createdAt"],
		}),
	).rejects.toThrow("QP-DATA-008 orderFieldNotSelected");
	expect(dispatches).toBe(0);
});

test("the decoded root cursor order boundary participates in the same statement", async () => {
	const decodedAfterId = "t1";
	const result = await client.query(inverseListSql, [
		"tenant-a",
		decodedAfterId,
		1,
		1,
	]);
	expect(
		decodeInverseList(result.rows, {
			rootFirst: 1,
			childFirst: 1,
			resultBytes: 1_048_576,
		}),
	).toEqual({
		nodes: [{ id: "t2", title: "second", comments: [] }],
		pageInfo: { hasNextPage: true },
	});
});

test("PostgreSQL cancellation and deadline abort the whole read-only snapshot", async () => {
	const running = new pg.Client({
		host: process.env.PGHOST,
		port: Number(process.env.PGPORT),
		database: process.env.PGDATABASE,
		user: process.env.PGUSER,
	});
	const control = new pg.Client({
		host: process.env.PGHOST,
		port: Number(process.env.PGPORT),
		database: process.env.PGDATABASE,
		user: process.env.PGUSER,
	});
	await Promise.all([running.connect(), control.connect()]);
	try {
		await running.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
		const backend = await running.query("SELECT pg_backend_pid() AS pid");
		const pid = Number(backend.rows[0]?.pid);
		const sleeping = running.query("SELECT pg_sleep(30)");
		const cancelled = await control.query(
			"SELECT pg_cancel_backend($1) AS cancelled",
			[pid],
		);
		expect(cancelled.rows[0]?.cancelled).toBe(true);
		await expect(sleeping).rejects.toMatchObject({ code: "57014" });
		await running.query("ROLLBACK");

		await running.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
		await running.query("SET LOCAL statement_timeout = '1ms'");
		await expect(running.query("SELECT pg_sleep(30)")).rejects.toMatchObject({
			code: "57014",
		});
		await running.query("ROLLBACK");
		expect((await running.query("SELECT 1 AS value")).rows[0]?.value).toBe(1);
	} finally {
		await Promise.allSettled([
			running.query("ROLLBACK"),
			control.end(),
			running.end(),
		]);
	}
});

test("decoder rejects forged ordinals, row overflow, cancellation, and byte overflow", () => {
	const row = {
		root_id: "t1",
		root_title: "first",
		root_ordinal: 1,
		child_id: null,
		child_body: null,
		child_body_allowed: null,
		child_created_at: null,
		child_ordinal: null,
	};
	expect(() =>
		decodeInverseList([{ ...row, root_ordinal: 0 }], {
			rootFirst: 1,
			childFirst: 1,
			resultBytes: 1_048_576,
		}),
	).toThrow("invalid root ordinal");
	expect(() =>
		decodeInverseList([{ ...row, root_ordinal: 2 }], {
			rootFirst: 2,
			childFirst: 1,
			resultBytes: 1_048_576,
		}),
	).toThrow("non-contiguous root ordinal");
	expect(() =>
		decodeInverseList([row, row, row], {
			rootFirst: 1,
			childFirst: 1,
			resultBytes: 1_048_576,
		}),
	).toThrow("QP-DATA-012");
	const controller = new AbortController();
	controller.abort(new Error("cancelled"));
	expect(() =>
		decodeInverseList([row], {
			rootFirst: 1,
			childFirst: 1,
			resultBytes: 1_048_576,
			signal: controller.signal,
		}),
	).toThrow("cancelled");
	expect(() =>
		decodeInverseList([row], {
			rootFirst: 1,
			childFirst: 1,
			resultBytes: 1,
		}),
	).toThrow("QP-DATA-012");
});
