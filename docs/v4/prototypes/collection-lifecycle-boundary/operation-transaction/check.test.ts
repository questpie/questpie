import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";

import { Pool } from "pg";

import {
	compileIssueCapability,
	directFailureBytes,
	OperationTransactionProof,
	ticketIssues,
	wireFailureBytes,
	type IssueIdentity,
	type ProofOutcome,
	type ProofTrace,
	type ReachabilityNode,
} from "./proof-kernel";

if (!process.env.PGHOST)
	throw new Error("PGHOST is required for the local PostgreSQL proof");

const pool = new Pool({
	host: process.env.PGHOST,
	port: Number(process.env.PGPORT ?? "5432"),
	database: process.env.PGDATABASE ?? "postgres",
	user: process.env.PGUSER ?? "postgres",
	max: 4,
});
const schema = `qp_lifecycle_${randomUUID().replaceAll("-", "")}`;
const ticketId = "018f5f6e-5f2c-7b41-a854-3d9a6b6b61a0";
let proof: OperationTransactionProof;

function trace(): ProofTrace {
	return { events: [], lifecycleRuns: 0, transactionIds: [] };
}

function mapped() {
	return new Map([
		[ticketIssues.emptyTitle, "EMPTY_TITLE"],
		[ticketIssues.forbiddenTitle, "FORBIDDEN_TITLE"],
	] as const);
}

function baseInput(suffix: string) {
	return {
		callId: `call-${suffix}`,
		ticketId,
		caller: { title: "  Ready  ", status: "open" },
		trusted: { secret: "  protected  " },
		issueMappings: mapped(),
	};
}

async function count(table: string): Promise<number> {
	if (!/^[a-z_]+$/.test(table)) throw new TypeError("unsafe table");
	const result = await pool.query<{ count: string }>(
		`SELECT count(*)::text AS count FROM ${schema}.${table}`,
	);
	return Number(result.rows[0]!.count);
}

function failure(outcome: ProofOutcome) {
	if (outcome.ok) throw new Error("expected proof failure");
	return outcome;
}

beforeAll(async () => {
	const version = await pool.query<{ server_version_num: string }>(
		"SHOW server_version_num",
	);
	expect(version.rows[0]?.server_version_num).toMatch(/^17\d{4}$/);
	await pool.query(`CREATE SCHEMA ${schema}`);
	await pool.query(`
		CREATE TABLE ${schema}.tickets (
			id uuid PRIMARY KEY,
			title text NOT NULL,
			secret text NOT NULL,
			status text NOT NULL CONSTRAINT ticket_status CHECK (status IN ('open', 'closed')),
			updated_at timestamptz NOT NULL
		);
		CREATE TABLE ${schema}.audit (
			ticket_id uuid NOT NULL,
			ordinal integer NOT NULL,
			transaction_id text NOT NULL
		);
		CREATE TABLE ${schema}.jobs (
			id text PRIMARY KEY,
			ticket_id uuid NOT NULL,
			transaction_id text NOT NULL
		);
		CREATE TABLE ${schema}.receipts (
			call_id text PRIMARY KEY,
			result jsonb NOT NULL,
			transaction_id text NOT NULL,
			now timestamptz NOT NULL
		)
	`);
	proof = new OperationTransactionProof(pool, schema);
});

afterAll(async () => {
	await pool.query(`DROP SCHEMA ${schema} CASCADE`);
	await pool.end();
});

describe("finding 3: issue ownership and Operation transaction", () => {
	test("only validate/check mint issues, first issue dooms despite catch, and mapping follows rollback", async () => {
		const validateTrace = trace();
		const validate = failure(
			await proof.execute(
				{
					...baseInput("validate-first"),
					caller: { title: "", status: "also-invalid" },
					catchIssue: true,
				},
				validateTrace,
			),
		);
		expect(validate.error).toEqual({
			kind: "declared",
			code: "EMPTY_TITLE",
			retryable: false,
		});
		expect(validateTrace.events).toContain("application-catch");
		expect(validateTrace.events.indexOf("rollback")).toBeLessThan(
			validateTrace.events.indexOf("map"),
		);
		expect(validateTrace.events).not.toContain(
			"constraint-and-database-values",
		);
		expect(await count("tickets")).toBe(0);

		const caughtLaterIssueTrace = trace();
		const caughtLaterIssue = failure(
			await proof.execute(
				{
					...baseInput("caught-first-identity"),
					caller: { title: "forbidden", status: "open" },
					catchIssue: true,
				},
				caughtLaterIssueTrace,
			),
		);
		expect(caughtLaterIssue.error.code).toBe("FORBIDDEN_TITLE");
		expect(caughtLaterIssueTrace.events.indexOf("rollback")).toBeLessThan(
			caughtLaterIssueTrace.events.indexOf("map"),
		);

		const checkTrace = trace();
		const check = failure(
			await proof.execute(
				{
					...baseInput("check-issue"),
					caller: { title: "database-forbidden", status: "open" },
				},
				checkTrace,
			),
		);
		expect(check.error.code).toBe("FORBIDDEN_TITLE");
		expect(checkTrace.events).toContain("check");
	});

	test("unknown, forged, malformed, and unmapped values sanitize without disclosure", async () => {
		for (const fault of [
			"unknown",
			"forged",
			"malformed",
			"unmapped",
		] as const) {
			const currentTrace = trace();
			const outcome = failure(
				await proof.execute(
					{ ...baseInput(`sanitize-${fault}`), fault },
					currentTrace,
				),
			);
			expect(outcome.error).toEqual({
				kind: "framework",
				code: "INTERNAL",
				retryable: false,
			});
			const bytes = new TextDecoder().decode(outcome.bytes);
			expect(bytes).not.toMatch(
				/collection:|ticket|protected|Policy|PostgreSQL|secret|stack|forged|\.\./,
			);
			expect(currentTrace.events.indexOf("rollback")).toBeLessThan(
				currentTrace.events.indexOf("map"),
			);
		}
	});

	test("PostgreSQL constraints remain internally distinct from Collection issues", async () => {
		const currentTrace = trace();
		const outcome = failure(
			await proof.execute(
				{
					...baseInput("constraint"),
					caller: { title: "valid", status: "not-a-status" },
				},
				currentTrace,
			),
		);
		expect(outcome.classification).toBe("postgresConstraint");
		expect(outcome.error).toEqual({
			kind: "framework",
			code: "INTERNAL",
			retryable: false,
		});
		expect(currentTrace.events).toContain("constraint-and-database-values");
		expect(currentTrace.events).not.toContain("afterWrite");
	});

	test("transitive reachability reports the complete QP-COMPOSE-027 path and withholds call capability", () => {
		const nodes = new Map<string, ReachabilityNode>([
			[
				"collection:tickets/update",
				{
					identity: "collection:tickets/update",
					issues: [],
					calls: ["collection:audit/create"],
				},
			],
			[
				"collection:audit/create",
				{
					identity: "collection:audit/create",
					issues: [],
					calls: ["collection:limits/check"],
				},
			],
			[
				"collection:limits/check",
				{
					identity: "collection:limits/check",
					issues: [ticketIssues.forbiddenTitle],
					calls: [],
				},
			],
		]);
		const blocked = compileIssueCapability({
			operation: "mutation:tickets.close",
			root: "collection:tickets/update",
			nodes,
			mappings: new Map(),
			declaredErrors: ["EMPTY_TITLE", "FORBIDDEN_TITLE"],
		});
		expect(blocked).toEqual({
			ok: false,
			code: "QP-COMPOSE-027",
			reason: "missingIssueMapping",
			path: [
				"mutation:tickets.close",
				"collection:tickets/update",
				"collection:audit/create",
				"collection:limits/check",
			],
			issue: ticketIssues.forbiddenTitle,
		});
		expect(blocked.call).toBeUndefined();

		const admitted = compileIssueCapability({
			operation: "mutation:tickets.close",
			root: "collection:tickets/update",
			nodes,
			mappings: new Map([[ticketIssues.forbiddenTitle, "FORBIDDEN_TITLE"]]),
			declaredErrors: ["EMPTY_TITLE", "FORBIDDEN_TITLE"],
		});
		expect(admitted).toEqual({
			ok: true,
			call: { identity: "mutation:tickets.close" },
		});

		const cyclicNodes = new Map(nodes);
		cyclicNodes.set("collection:limits/check", {
			identity: "collection:limits/check",
			issues: [ticketIssues.forbiddenTitle],
			calls: ["collection:tickets/update"],
		});
		expect(
			compileIssueCapability({
				operation: "mutation:tickets.close",
				root: "collection:tickets/update",
				nodes: cyclicNodes,
				mappings: new Map([[ticketIssues.forbiddenTitle, "FORBIDDEN_TITLE"]]),
				declaredErrors: ["EMPTY_TITLE", "FORBIDDEN_TITLE"],
			}),
		).toEqual({
			ok: true,
			call: { identity: "mutation:tickets.close" },
		});

		const invalidMapping = compileIssueCapability({
			operation: "mutation:tickets.close",
			root: "collection:tickets/update",
			nodes,
			mappings: new Map([
				[ticketIssues.forbiddenTitle, "BORROWED_FROM_ANOTHER_MUTATION"],
			]),
			declaredErrors: ["EMPTY_TITLE", "FORBIDDEN_TITLE"],
		});
		expect(invalidMapping).toMatchObject({
			ok: false,
			code: "QP-COMPOSE-027",
			reason: "invalidIssueMapping",
			issue: ticketIssues.forbiddenTitle,
			mappedError: "BORROWED_FROM_ANOTHER_MUTATION",
		});
		expect(invalidMapping.call).toBeUndefined();

		const invalidDeclaration = compileIssueCapability({
			operation: "mutation:tickets.close",
			root: "collection:invalid/update",
			nodes: new Map([
				[
					"collection:invalid/update",
					{
						identity: "collection:invalid/update",
						issues: ["collection:../issue:bad" as IssueIdentity],
						calls: [],
					},
				],
			]),
			mappings: new Map(),
			declaredErrors: ["INVALID"],
		});
		expect(invalidDeclaration).toMatchObject({
			ok: false,
			code: "QP-COMPOSE-027",
			reason: "invalidIssueDeclaration",
			issue: "collection:../issue:bad",
		});
		expect(invalidDeclaration.call).toBeUndefined();
	});

	test("direct and wire adapters emit identical minimal declared-error bytes", async () => {
		const outcome = failure(
			await proof.execute(
				{
					...baseInput("parity"),
					caller: { title: "", status: "open" },
				},
				trace(),
			),
		);
		expect(directFailureBytes(outcome)).toEqual(wireFailureBytes(outcome));
		expect(new TextDecoder().decode(outcome.bytes)).toBe(
			'{"ok":false,"error":{"kind":"declared","code":"EMPTY_TITLE","retryable":false}}',
		);
	});
});

describe("finding 4: lifecycle order, atomic work, budgets, time, and replay", () => {
	test("preserves separate normalized paths and exact lifecycle/database order", async () => {
		const currentTrace = trace();
		const outcome = await proof.execute(baseInput("ordered"), currentTrace);
		expect(outcome.ok).toBe(true);
		expect(currentTrace.events).toEqual([
			"begin",
			"normalize:caller",
			"normalize:trusted",
			"codec",
			"validate",
			"candidate-policy",
			"check",
			"constraint-and-database-values",
			"afterWrite",
			"nested-write:0",
			"job-accept",
			"receipt",
			"commit",
		]);
		if (!outcome.ok) throw new Error("expected success");
		expect(outcome.result.title).toBe("Ready");
		expect(outcome.result).not.toHaveProperty("secret");
		const persisted = await pool.query<{ secret: string }>(
			`SELECT secret FROM ${schema}.tickets WHERE id = $1`,
			[ticketId],
		);
		expect(persisted.rows[0]?.secret).toBe("protected");

		const codecTrace = trace();
		const codecFailure = failure(
			await proof.execute(
				{
					...baseInput("bad-codec"),
					caller: { title: 42, status: "open" },
				},
				codecTrace,
			),
		);
		expect(codecFailure.error.code).toBe("INTERNAL");
		expect(codecTrace.events).toContain("codec");
		expect(codecTrace.events).not.toContain("validate");

		const policyTrace = trace();
		const policyFailure = failure(
			await proof.execute(
				{
					...baseInput("policy-before-check"),
					trusted: { secret: "policy-denied" },
				},
				policyTrace,
			),
		);
		expect(policyFailure.error.code).toBe("INTERNAL");
		expect(policyTrace.events).toContain("candidate-policy");
		expect(policyTrace.events).not.toContain("check");

		const overlapTrace = trace();
		const overlapFailure = failure(
			await proof.execute(
				{
					...baseInput("lane-overlap"),
					caller: { title: "Ready", status: "open", secret: "caller" },
				},
				overlapTrace,
			),
		);
		expect(overlapFailure.error.code).toBe("INTERNAL");
		expect(overlapTrace.events).toContain("normalize:caller");
		expect(overlapTrace.events).toContain("normalize:trusted");
		expect(overlapTrace.events).not.toContain("codec");
	});

	test("nested writes and Job acceptance share the outer PostgreSQL transaction in authored order", async () => {
		const currentTrace = trace();
		const outcome = await proof.execute(
			{
				...baseInput("nested"),
				nestedDepth: 2,
			},
			currentTrace,
		);
		if (!outcome.ok) throw new Error("expected success");
		const rows = await pool.query<{ ordinal: number; transaction_id: string }>(
			`SELECT ordinal, transaction_id FROM ${schema}.audit WHERE ticket_id = $1 ORDER BY ctid`,
			[ticketId],
		);
		const latest = rows.rows.slice(-3);
		expect(latest.map(({ ordinal }) => ordinal)).toEqual([0, 1, 2]);
		expect(new Set(latest.map(({ transaction_id }) => transaction_id))).toEqual(
			new Set([outcome.transactionId]),
		);
		const job = await pool.query<{ transaction_id: string }>(
			`SELECT transaction_id FROM ${schema}.jobs WHERE id = $1`,
			["call-nested:job"],
		);
		expect(job.rows[0]?.transaction_id).toBe(outcome.transactionId);
	});

	test("statement budget and artifact re-entry limit doom all nested work", async () => {
		for (const [suffix, limits] of [
			["budget", { nestedDepth: 2, maxStatements: 2 }],
			["reentry", { nestedDepth: 3, maxReentry: 1 }],
		] as const) {
			const before = await count("audit");
			const jobsBefore = await count("jobs");
			const outcome = failure(
				await proof.execute({ ...baseInput(suffix), ...limits }, trace()),
			);
			expect(outcome.classification).toBe("limit");
			expect(outcome.error.code).toBe("INTERNAL");
			expect(await count("audit")).toBe(before);
			expect(await count("jobs")).toBe(jobsBefore);
		}
	});

	test("ctx.now is transaction-stable and database-owned onUpdate advances", async () => {
		const first = await proof.execute(baseInput("clock-one"), trace());
		if (!first.ok) throw new Error("expected success");
		await Bun.sleep(10);
		const second = await proof.execute(
			{
				...baseInput("clock-two"),
				caller: { title: "Changed", status: "closed" },
			},
			trace(),
		);
		if (!second.ok) throw new Error("expected success");
		expect(first.result.updatedAt).toBe(first.now);
		expect(second.result.updatedAt).toBe(second.now);
		expect(Date.parse(second.now)).toBeGreaterThan(Date.parse(first.now));

		const supplied = failure(
			await proof.execute(
				{
					...baseInput("clock-forged"),
					trusted: {
						secret: "protected",
						updatedAt: "2000-01-01T00:00:00.000Z",
					},
				},
				trace(),
			),
		);
		expect(supplied.error.code).toBe("QP-DATA-023");
	});

	test("cancellation and deadline roll back without automatic retry", async () => {
		for (const fault of ["cancel", "deadline"] as const) {
			const currentTrace = trace();
			const before = await count("tickets");
			const outcome = failure(
				await proof.execute(
					{ ...baseInput(`stop-${fault}`), fault },
					currentTrace,
				),
			);
			expect(outcome.classification).toBe(
				fault === "cancel" ? "cancelled" : "deadline",
			);
			expect(currentTrace.lifecycleRuns).toBe(1);
			expect(currentTrace.transactionIds).toHaveLength(1);
			expect(await count("tickets")).toBe(before);
		}
	});

	test("explicit retry is fresh while committed replay performs no lifecycle work", async () => {
		const failedTrace = trace();
		const failed = failure(
			await proof.execute(
				{ ...baseInput("retry"), fault: "cancel" },
				failedTrace,
			),
		);
		expect(failed.classification).toBe("cancelled");

		const retryTrace = trace();
		const retry = await proof.execute(baseInput("retry"), retryTrace);
		if (!retry.ok) throw new Error("expected retry success");
		expect(retryTrace.lifecycleRuns).toBe(1);
		expect(retry.transactionId).not.toBe(failedTrace.transactionIds[0]);

		const replayTrace = trace();
		const replay = await proof.execute(baseInput("retry"), replayTrace);
		if (!replay.ok) throw new Error("expected replay success");
		expect(replay.replayed).toBe(true);
		expect(replay.transactionId).toBe(retry.transactionId);
		expect(replay.result).toEqual(retry.result);
		expect(replayTrace.lifecycleRuns).toBe(0);
		expect(replayTrace.events).toEqual(["committed-replay"]);
	});
});
