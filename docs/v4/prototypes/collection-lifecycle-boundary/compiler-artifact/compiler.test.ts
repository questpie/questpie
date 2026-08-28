import { test } from "bun:test";
import {
	deepStrictEqual,
	doesNotMatch,
	match,
	notStrictEqual,
	rejects,
	strictEqual,
	throws,
} from "node:assert";

import {
	INTERPRETER,
	InterpretedIssue,
	LifecycleDiagnostic,
	artifactDigest,
	compileArtifact,
	createExecutionBudget,
	decodeArtifact,
	encodeArtifact,
	executePhase,
	loadArtifact,
	lowerPhase,
	lowerPhaseFromModule,
	type Artifact,
	type Bindings,
	type Phase,
} from "./compiler";

const runtimeBuild = "b".repeat(64);
const bindings = Object.freeze({
	schema: "schema:helpdesk-v4",
	collection: "collection:helpdesk/tickets",
	fields: Object.freeze({
		id: "field:helpdesk/tickets/id",
		name: "field:helpdesk/tickets/name",
		status: "field:helpdesk/tickets/status",
		count: "field:helpdesk/tickets/count",
		prefix: "field:helpdesk/tickets/prefix",
		occurredAt: "field:helpdesk/tickets/occurredAt",
	}),
	issues: Object.freeze({ invalidName: "issue:helpdesk/tickets/invalidName" }),
	capabilities: Object.freeze({
		"data.related.find": Object.freeze({
			kind: "read",
			identity: "operation:helpdesk/tickets/findRelated",
			argumentKeys: Object.freeze(["id"]),
			cardinality: "many",
			first: false,
			maxRows: 2,
		}),
		"data.related.update": Object.freeze({
			kind: "write",
			identity: "operation:helpdesk/tickets/updateRelated",
			argumentKeys: Object.freeze(["id", "status"]),
		}),
		"jobs.ticket.notify.accept": Object.freeze({
			kind: "acceptJob",
			identity: "job:helpdesk/tickets/notify",
			argumentKeys: Object.freeze(["id", "occurredAt", "idempotencyKey"]),
		}),
	}),
	operations: Object.freeze([
		"operation:helpdesk/tickets/findRelated",
		"operation:helpdesk/tickets/updateRelated",
	]),
	jobs: Object.freeze(["job:helpdesk/tickets/notify"]),
} satisfies Bindings);

const callbacks = Object.freeze({
	normalize: `({ input }) => {
		/* AUTHORED_CALLBACK_BYTES_MUST_BE_DISPOSED */
		const clean = input.name.trim().toLowerCase();
		return { ...input, name: clean, prefix: \`ticket-${"${input.id}"}\` };
	}`,
	validate: `({ candidate, current, now, issues }) => {
		const invalid = candidate.name === "" || candidate.count < 0;
		if (invalid) throw issues.invalidName();
		if (current?.status !== candidate.status && now !== null) return candidate;
		else return current ?? candidate;
	}`,
	check: `async ({ candidate, current, ctx, issues }) => {
		const rows = await ctx.data.related.find({ id: candidate.id });
		if (rows === null) throw issues.invalidName();
		return candidate;
	}`,
	afterWrite: `async ({ row, previous, ctx }) => {
		const rows = await ctx.data.related.find({ id: row.id });
		for (const row of rows) {
			await ctx.data.related.update({ id: row.id, status: previous?.status ?? "new" });
		}
		await ctx.jobs.ticket.notify.accept({ id: row.id, occurredAt: ctx.now, idempotencyKey: ctx.callId });
		return row;
	}`,
} satisfies Readonly<Record<Phase, string>>);

function compile(modulePrefix = "/checkout/a/src"): Artifact {
	return compileArtifact({
		callbacks,
		bindings,
		runtimeBuild,
		reentryLimit: 8,
	});
}

function clone(value: unknown): any {
	return JSON.parse(JSON.stringify(value));
}

function executionBudget(
	overrides: Partial<Parameters<typeof createExecutionBudget>[0]> = {},
) {
	return createExecutionBudget({
		deadline: Number.MAX_SAFE_INTEGER,
		maxStatements: 100,
		maxRows: 100,
		maxDependencies: 100,
		maxDurationMilliseconds: 60_000,
		maxArtifactReentry: 8,
		...overrides,
	});
}

const expectedContract = Object.freeze({ runtimeBuild, bindings });

function canonicalHostile(value: unknown): string {
	if (value === null || typeof value === "boolean" || typeof value === "number")
		return JSON.stringify(value);
	if (typeof value === "string") return JSON.stringify(value);
	if (Array.isArray(value))
		return `[${value.map((member) => canonicalHostile(member)).join(",")}]`;
	if (value && typeof value === "object")
		return `{${Object.entries(value)
			.toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(
				([key, member]) => `${JSON.stringify(key)}:${canonicalHostile(member)}`,
			)
			.join(",")}}`;
	throw new TypeError("hostile fixture is not JSON");
}

function hostileBytes(value: unknown): Uint8Array {
	return new TextEncoder().encode(canonicalHostile(value));
}

function expectDiagnostic(
	source: string,
	phase: Phase,
	reason: LifecycleDiagnostic["reason"],
): LifecycleDiagnostic {
	let caught: unknown;
	try {
		lowerPhase(phase, source, bindings, `src/${phase}.ts`);
	} catch (error) {
		caught = error;
	}
	strictEqual(caught instanceof LifecycleDiagnostic, true);
	const diagnostic = caught as LifecycleDiagnostic;
	strictEqual(diagnostic.code, "QP-COMPOSE-026");
	strictEqual(diagnostic.reason, reason);
	strictEqual(diagnostic.phase, phase);
	deepStrictEqual(diagnostic.origin.module, `src/${phase}.ts`);
	strictEqual(diagnostic.origin.line >= 1, true);
	strictEqual(diagnostic.origin.column >= 1, true);
	match(
		diagnostic.rewrite,
		/use|rewrite|pass|declare|author|provide|iterate|throw|spread|await|replace|remove/,
	);
	return diagnostic;
}

test("ordinary TypeScript lowers all four phases and the interpreter never invokes authored callbacks", async () => {
	let invocations = 0;
	const authoredNormalize = ((input: any) => {
		invocations += 1;
		return input;
	}) as unknown as Function & { toString(): string };
	authoredNormalize.toString = () =>
		`({ input }) => ({ ...input, name: input.name.trim() })`;
	const artifact = compileArtifact({
		callbacks: { ...callbacks, normalize: authoredNormalize },
		bindings,
		runtimeBuild,
		reentryLimit: 8,
	});
	strictEqual(invocations, 0);
	const bytes = encodeArtifact(artifact);
	strictEqual(invocations, 0);
	doesNotMatch(
		new TextDecoder().decode(bytes),
		/invocations|authoredNormalize|=>|AUTHORED_CALLBACK_BYTES_MUST_BE_DISPOSED/,
	);
	strictEqual(JSON.stringify(artifact).includes("function"), false);

	deepStrictEqual(
		await executePhase(
			artifact,
			"normalize",
			[{ id: "T-1", name: "  HELLO  ", status: "open", count: 1 }],
			{},
			executionBudget(),
		),
		{ id: "T-1", name: "HELLO", status: "open", count: 1 },
	);
	deepStrictEqual(
		await executePhase(
			artifact,
			"validate",
			[
				{ id: "T-1", name: "ok", status: "open", count: 1 },
				null,
				"2026-08-28T10:00:00.000Z",
				{},
			],
			{},
			executionBudget(),
		),
		{ id: "T-1", name: "ok", status: "open", count: 1 },
	);
	await executePhase(
		artifact,
		"check",
		[
			{ id: "T-1", name: "ok", status: "open", count: 1 },
			null,
			"2026-08-28T10:00:00.000Z",
			{},
			{},
		],
		{
			"operation:helpdesk/tickets/findRelated": () => [],
		},
		executionBudget(),
	);
	const effects: string[] = [];
	await executePhase(
		artifact,
		"afterWrite",
		[
			{ id: "T-1", name: "ok", status: "closed", count: 1 },
			null,
			"2026-08-28T10:00:00.000Z",
			{},
			"call:T-1",
		],
		{
			"operation:helpdesk/tickets/findRelated": () => [
				{ id: "T-2" },
				{ id: "T-3" },
			],
			"operation:helpdesk/tickets/updateRelated": ({ arguments: [input] }) =>
				effects.push(`write:${(input as any).id}`),
			"job:helpdesk/tickets/notify": ({ arguments: [input] }) =>
				effects.push(`job:${(input as any).id}`),
		},
		executionBudget(),
	);
	deepStrictEqual(effects, ["write:T-2", "write:T-3", "job:T-1"]);
	strictEqual(invocations, 0);
});

test("Lifecycle Program v1 accepted grammar has executable coverage", async () => {
	const program = lowerPhase(
		"normalize",
		`({ input }) => {
		const a = !false;
		const b = -1 + 2 - 3 * 4 / 5 % 6;
		const c = input?.name.trim().toUpperCase().toLowerCase();
		const d = c.startsWith("a") && c.endsWith("z") || c.includes("m");
		const e = input.count === 1 && input.count !== 2 && input.count < 3 && input.count <= 3 && input.count > 0 && input.count >= 0;
		const f = input.name ?? "none";
		const g = d ? [null, true, 1, "x"] : [];
		if (a && e) return { ...input, name: f, prefix: \`${"${b}"}:${"${g}"}\` };
		else return input;
	}`,
		bindings,
		"grammar.ts",
	);
	strictEqual(program.length, 8);
	strictEqual(JSON.stringify(program).includes('"optional":true'), true);
	const artifact = compileArtifact({
		callbacks: {
			...callbacks,
			normalize: `({ input }) => {
				const a = !false;
				const b = -1 + 2 - 3 * 4 / 5 % 6;
				const c = input.name?.trim().toUpperCase().toLowerCase();
				const d = c.startsWith("a") && c.endsWith("z") || c.includes("m");
				const e = input.count === 1 && input.count !== 2 && input.count < 3 && input.count <= 3 && input.count > 0 && input.count >= 0;
				const f = input.name ?? "none";
				const g = d ? [null, true, 1, "x"] : [];
				if (a && e) return { ...input, name: f, prefix: \`${"${b}"}:${"${g}"}\` };
				else return input;
			}`,
		},
		bindings,
		runtimeBuild,
		reentryLimit: 8,
	});
	deepStrictEqual(
		await executePhase(
			artifact,
			"normalize",
			[{ id: "T-1", name: "amz", count: 1 }],
			{},
			executionBudget(),
		),
		{ id: "T-1", name: "amz", count: 1, prefix: "-1.4:,true,1,x" },
	);
	strictEqual(
		await executePhase(
			compileArtifact({
				callbacks: {
					...callbacks,
					normalize: `({ input }) => input.name?.trim().toLowerCase()`,
				},
				bindings,
				runtimeBuild,
				reentryLimit: 8,
			}),
			"normalize",
			[{}],
			{},
			executionBudget(),
		),
		undefined,
	);
	for (const source of [
		`({ input }) => input?.name.trim()`,
		`({ input }) => input?.name?.trim()`,
	])
		strictEqual(
			await executePhase(
				compileArtifact({
					callbacks: { ...callbacks, normalize: source },
					bindings,
					runtimeBuild,
					reentryLimit: 8,
				}),
				"normalize",
				[null],
				{},
				executionBudget(),
			),
			undefined,
		);
	for (const source of [
		`({ input }) => input.name.trim("x")`,
		`({ input }) => input.name.includes()`,
		`({ input }) => input.name.startsWith("x", "y")`,
	])
		expectDiagnostic(source, "normalize", "unsupportedLifecycleSyntax");
	await rejects(
		executePhase(
			compileArtifact({
				callbacks: {
					...callbacks,
					normalize: `({ input }) => input.count / 0`,
				},
				bindings,
				runtimeBuild,
				reentryLimit: 8,
			}),
			"normalize",
			[{ count: 1 }],
			{},
			executionBudget(),
		),
		/finite runtime domain/,
	);
	await rejects(
		executePhase(
			compileArtifact({
				callbacks: {
					...callbacks,
					normalize: `({ input }) => input.name.includes(input.count)`,
				},
				bindings,
				runtimeBuild,
				reentryLimit: 8,
			}),
			"normalize",
			[{ name: "x", count: 1 }],
			{},
			executionBudget(),
		),
		/string method argument/,
	);
});

test("QP-COMPOSE-026 is Origin-bound and closes unsupported syntax and captures", () => {
	const unsupported = [
		`({ input }) => { let x = 1; return input; }`,
		`({ input }) => { var x = 1; return input; }`,
		`({ input }) => { input.name = "x"; return input; }`,
		`({ input }) => { input.count++; return input; }`,
		`({ input }) => { switch (input.status) { default: return input; } }`,
		`({ input }) => { try { return input; } catch { return input; } }`,
		`({ input }) => { function nested() {}; return input; }`,
		`({ input }) => { class X {}; return input; }`,
		`function* ({ input }) { return input; }`,
		`({ input }) => input[input.name]`,
		`({ input }) => ({ ...input.name })`,
		`({ input }) => { while (true) return input; }`,
		`({ input }) => new Date()`,
	];
	for (const source of unsupported)
		expectDiagnostic(source, "normalize", "unsupportedLifecycleSyntax");
	for (const source of [
		`({ input }) => importedHelper(input)`,
		`({ input }) => process.env.VALUE`,
		`({ input }) => globalThis.fetch("https://example.test")`,
		`({ input }) => captured`,
		`({ input }) => Bun.file("secret")`,
		`({ input }) => service.send(input)`,
		`({ input }) => sql\`select 1\``,
		`({ input }) => Math.random()`,
		`({ input }) => Promise.all([])`,
		`({ input }) => { setTimeout(() => {}, 0); return input; }`,
	])
		expectDiagnostic(source, "normalize", "lifecycleCapture");
	expectDiagnostic(
		`async ({ input }) => input`,
		"normalize",
		"unsupportedLifecycleSyntax",
	);
	expectDiagnostic(
		`({ candidate, current, now, issues }) => { throw new Error("x"); }`,
		"validate",
		"unsupportedLifecycleSyntax",
	);
	expectDiagnostic(
		`({ input }) => { for (const x of input.items) return input; }`,
		"normalize",
		"unsupportedLifecycleSyntax",
	);
	expectDiagnostic(
		`({ input }) => input.__proto__`,
		"normalize",
		"unsupportedLifecycleSyntax",
	);
	expectDiagnostic(
		`(input) => input`,
		"normalize",
		"unsupportedLifecycleSyntax",
	);
	throws(
		() =>
			lowerPhaseFromModule(
				"normalize",
				`import { helper } from "./helper";\nexport const normalize = ({ input }) => helper(input);`,
				"normalize",
				bindings,
				"src/imported.ts",
			),
		(error: unknown) =>
			error instanceof LifecycleDiagnostic &&
			error.reason === "lifecycleCapture" &&
			error.origin.module === "src/imported.ts" &&
			error.origin.line === 1,
	);
});

test("phase capability closure rejects Services, Actions, SQL, transactions, timers, parallel and detached work", () => {
	for (const phase of ["normalize", "validate"] as const) {
		const parameters =
			phase === "normalize"
				? "{ input }"
				: "{ candidate, current, now, issues }";
		expectDiagnostic(
			`async (${parameters}) => { await ctx.data.related.find({ id: candidate.id }); }`,
			phase,
			"unsupportedLifecycleSyntax",
		);
	}
	expectDiagnostic(
		`async ({ candidate, ctx, issues }) => { await ctx.data.related.update({ id: candidate.id }); }`,
		"check",
		"unsupportedLifecycleCapability",
	);
	expectDiagnostic(
		`async ({ candidate, ctx, issues }) => { await ctx.jobs.ticket.notify.accept({ id: candidate.id }); }`,
		"check",
		"unsupportedLifecycleCapability",
	);
	expectDiagnostic(
		`async ({ candidate, ctx, issues }) => { ctx.data.related.find({ id: candidate.id }); return candidate; }`,
		"check",
		"unsupportedLifecycleSyntax",
	);
	for (const expression of [
		"services.mail.send(candidate)",
		"actions.deliver(candidate)",
		"sql.query(candidate)",
		"transaction.commit()",
		"fetch(candidate.name)",
		"setTimeout(candidate, 1)",
		"Promise.all([])",
	])
		expectDiagnostic(
			`async ({ candidate, ctx, issues }) => { await ${expression}; }`,
			"check",
			"unsupportedLifecycleCapability",
		);
	expectDiagnostic(
		`async ({ row, previous, ctx }) => { const rows = await ctx.data.related.find({ id: row.id }); await Promise.all(rows); }`,
		"afterWrite",
		"unsupportedLifecycleCapability",
	);
	expectDiagnostic(
		`async ({ row, previous, ctx }) => { const rows = await ctx.data.related.find({ id: row.id }); ctx.data.related.update({ id: row.id }); }`,
		"afterWrite",
		"unsupportedLifecycleSyntax",
	);
	expectDiagnostic(
		`async ({ row, previous, ctx }) => { for (const item of row.items) return item; }`,
		"afterWrite",
		"unsupportedLifecycleSyntax",
	);
	expectDiagnostic(
		`async ({ row, previous, ctx }) => { await ctx.data.related.update({ id: (await ctx.data.related.find({ id: row.id })).id }); }`,
		"afterWrite",
		"unsupportedLifecycleCapability",
	);
	expectDiagnostic(
		`({ input, issues }) => { throw issues.invalidName(); }`,
		"normalize",
		"unsupportedLifecycleSyntax",
	);
	expectDiagnostic(
		`async ({ row, previous, ctx, issues }) => { throw issues.invalidName(); }`,
		"afterWrite",
		"unsupportedLifecycleSyntax",
	);
});

test("canonical artifact round-trips exactly with every required identity and compatibility binding", () => {
	const artifact = compile();
	const bytes = encodeArtifact(artifact);
	const digest = artifactDigest(bytes);
	strictEqual(
		digest,
		"b5f397e272ce2830948943f745e377d602f32df651d8fee65fc3f31036f7c58f",
	);
	const expected = expectedContract;
	deepStrictEqual(loadArtifact(bytes, digest, expected), artifact);
	strictEqual(
		encodeArtifact(decodeArtifact(bytes, expected)).toString(),
		bytes.toString(),
	);
	strictEqual(
		new TextDecoder().decode(bytes),
		new TextDecoder().decode(encodeArtifact(clone(artifact))),
	);
	match(new TextDecoder().decode(bytes), /schema:helpdesk-v4/);
	for (const identity of [
		...Object.values(bindings.fields),
		...Object.values(bindings.issues),
		...bindings.operations,
		...bindings.jobs,
	])
		match(
			new TextDecoder().decode(bytes),
			new RegExp(identity.replaceAll("/", "\\/")),
		);
	strictEqual(artifact.interpreter, INTERPRETER);
	strictEqual(artifact.reentryLimit, 8);
});

test("canonical encoding rejects ambiguous and open operands", () => {
	const artifact = compile();
	for (const value of [
		Number.NaN,
		Number.POSITIVE_INFINITY,
		Number.NEGATIVE_INFINITY,
		-0,
		undefined,
		1n,
		Symbol("x"),
		() => 1,
	]) {
		const hostile = clone(artifact);
		hostile.phases.normalize[0].value = { op: "literal", value };
		throws(() => encodeArtifact(hostile), TypeError);
	}
	const unknownOpcode = clone(artifact);
	unknownOpcode.phases.normalize[0].value = { op: "future", value: null };
	throws(() => encodeArtifact(unknownOpcode), /unknown expression opcode/);
	const extraMember = clone(artifact);
	extraMember.phases.normalize[0].value.extra = null;
	throws(() => encodeArtifact(extraMember), /unknown or missing members/);
	const unboundField = clone(artifact);
	unboundField.bindings.fields.name = "field:other/private";
	throws(() => encodeArtifact(unboundField), /unbound field/);
	const unboundCapability = clone(artifact);
	unboundCapability.bindings.operations = [];
	throws(() => encodeArtifact(unboundCapability), /unbound capability binding/);
	const duplicateField = clone(artifact);
	duplicateField.bindings.fields.name = duplicateField.bindings.fields.id;
	throws(() => encodeArtifact(duplicateField), /identities must be unique/);
});

test("independent expected contract rejects every recomputed binding substitution and non-map binding", () => {
	const rejectRecomputed = (
		mutate: (artifact: any) => void,
		expectedError: RegExp = /compatibility binding mismatch/,
	) => {
		const hostile = clone(compile());
		mutate(hostile);
		const bytes = hostileBytes(hostile);
		throws(
			() => loadArtifact(bytes, artifactDigest(bytes), expectedContract),
			expectedError,
		);
	};
	rejectRecomputed((artifact) => {
		const old = artifact.bindings.fields.name;
		artifact.bindings.fields.name = "field:other/tickets/stolen";
		const rewrite = (value: unknown): void => {
			if (!value || typeof value !== "object") return;
			for (const [key, member] of Object.entries(value)) {
				if (member === old) (value as any)[key] = artifact.bindings.fields.name;
				else rewrite(member);
			}
		};
		rewrite(artifact.phases);
	});
	rejectRecomputed((artifact) => {
		const old = artifact.bindings.issues.invalidName;
		artifact.bindings.issues.invalidName = "issue:other/stolen";
		const rewrite = (value: unknown): void => {
			if (!value || typeof value !== "object") return;
			for (const [key, member] of Object.entries(value)) {
				if (member === old)
					(value as any)[key] = artifact.bindings.issues.invalidName;
				else rewrite(member);
			}
		};
		rewrite(artifact.phases);
	});
	rejectRecomputed((artifact) => {
		const old = artifact.bindings.operations[0];
		artifact.bindings.operations[0] = "operation:other/stolen";
		artifact.bindings.capabilities["data.related.find"].identity =
			artifact.bindings.operations[0];
		const rewrite = (value: unknown): void => {
			if (!value || typeof value !== "object") return;
			for (const [key, member] of Object.entries(value)) {
				if (member === old)
					(value as any)[key] = artifact.bindings.operations[0];
				else rewrite(member);
			}
		};
		rewrite(artifact.phases);
	});
	rejectRecomputed((artifact) => {
		const old = artifact.bindings.jobs[0];
		artifact.bindings.jobs[0] = "job:other/stolen";
		artifact.bindings.capabilities["jobs.ticket.notify.accept"].identity =
			artifact.bindings.jobs[0];
		const rewrite = (value: unknown): void => {
			if (!value || typeof value !== "object") return;
			for (const [key, member] of Object.entries(value)) {
				if (member === old) (value as any)[key] = artifact.bindings.jobs[0];
				else rewrite(member);
			}
		};
		rewrite(artifact.phases);
	});
	for (const name of ["fields", "issues", "capabilities"])
		rejectRecomputed((artifact) => {
			artifact.bindings[name] = [];
		}, /exact plain binding map/);
	const malformed = clone(compile());
	malformed.bindings.capabilities["data.related.find"].maxRows = 0;
	const malformedBytes = hostileBytes(malformed);
	throws(
		() =>
			loadArtifact(
				malformedBytes,
				artifactDigest(malformedBytes),
				expectedContract,
			),
		/invalid bounded read capability binding/,
	);
});

test("generated structural Operation and Job arguments execute without becoming Collection Fields", async () => {
	const publicBindings = clone(bindings) as Bindings;
	(publicBindings.fields as any).summary = "field:helpdesk/tickets/summary";
	(publicBindings.fields as any).teamId = "field:helpdesk/tickets/teamId";
	(publicBindings.operations as any) = [
		"operation:helpdesk/teams/get",
		"operation:helpdesk/ticketEvents/create",
	];
	(publicBindings.jobs as any) = ["job:helpdesk/tickets/reindex"];
	(publicBindings.capabilities as any) = {
		"data.teams.get": {
			kind: "read",
			identity: "operation:helpdesk/teams/get",
			argumentKeys: ["key.id", "select.id"],
			cardinality: "one",
			first: true,
			maxRows: 1,
		},
		"data.ticketEvents.create": {
			kind: "write",
			identity: "operation:helpdesk/ticketEvents/create",
			argumentKeys: [
				"values.ticketId",
				"values.kind",
				"values.occurredAt",
				"select.id",
			],
		},
		"jobs.ticket.reindex.accept": {
			kind: "acceptJob",
			identity: "job:helpdesk/tickets/reindex",
			argumentKeys: ["input.ticketId", "idempotencyKey"],
		},
	};
	const artifact = compileArtifact({
		callbacks: {
			...callbacks,
			normalize: `({ input }) =>
				input.summary?.includes("")
					? { ...input, summary: input.summary.trim() }
					: input`,
			check: `async ({ candidate, ctx, issues }) => {
				const team = await ctx.data.teams.get({ key: { id: candidate.teamId }, select: { id: true } });
				if (team === null) throw issues.invalidName();
			}`,
			afterWrite: `async ({ row, previous, ctx }) => {
				await ctx.data.ticketEvents.create({
					values: { ticketId: row.id, kind: previous ? "updated" : "created", occurredAt: ctx.now },
					select: { id: true },
				});
				await ctx.jobs.ticket.reindex.accept({ input: { ticketId: row.id }, idempotencyKey: \`ticket:${"${row.id}"}:${"${ctx.callId}"}\` });
			}`,
		},
		bindings: publicBindings,
		runtimeBuild,
		reentryLimit: 8,
	});
	const observed: unknown[] = [];
	const sparse = { id: "T-1", teamId: "TEAM-1" };
	strictEqual(
		await executePhase(artifact, "normalize", [sparse], {}, executionBudget()),
		sparse,
	);
	deepStrictEqual(
		await executePhase(
			artifact,
			"normalize",
			[{ ...sparse, summary: " hello " }],
			{},
			executionBudget(),
		),
		{ ...sparse, summary: "hello" },
	);
	await executePhase(
		artifact,
		"check",
		[{ id: "T-1", teamId: "TEAM-1" }, null, "2026-08-28T10:00:00.000Z", {}, {}],
		{
			"operation:helpdesk/teams/get": ({ arguments: values }) => {
				observed.push(values[0]);
				return { id: "TEAM-1" };
			},
		},
		executionBudget(),
	);
	await executePhase(
		artifact,
		"afterWrite",
		[{ id: "T-1" }, null, "2026-08-28T10:00:00.000Z", {}, "call-1"],
		{
			"operation:helpdesk/ticketEvents/create": ({ arguments: values }) => {
				observed.push(values[0]);
			},
			"job:helpdesk/tickets/reindex": ({ arguments: values }) => {
				observed.push(values[0]);
			},
		},
		executionBudget(),
	);
	deepStrictEqual(observed, [
		{ key: { id: "TEAM-1" }, select: { id: true } },
		{
			values: {
				ticketId: "T-1",
				kind: "created",
				occurredAt: "2026-08-28T10:00:00.000Z",
			},
			select: { id: true },
		},
		{ input: { ticketId: "T-1" }, idempotencyKey: "ticket:T-1:call-1" },
	]);
	expectDiagnostic(
		`async ({ candidate, ctx }) => { await ctx.data.related.find({ dynamic: candidate.id }); }`,
		"check",
		"unsupportedLifecycleSyntax",
	);
	throws(
		() =>
			lowerPhase(
				"afterWrite",
				`async ({ row, ctx }) => {
					const one = await ctx.data.teams.get({ key: { id: row.teamId }, select: { id: true } });
					for (const item of one) return item;
				}`,
				publicBindings,
				"public-example.ts",
			),
		(error: unknown) =>
			error instanceof LifecycleDiagnostic &&
			error.reason === "unsupportedLifecycleSyntax" &&
			/iterate only/.test(error.rewrite),
	);
});

test("recomputed digests cannot bypass phase, sequential-effect, issue, or slot closure", () => {
	const expected = expectedContract;
	const rejectHostile = (
		mutate: (artifact: any) => void,
		expectedError: RegExp,
	) => {
		const hostile = clone(compile());
		mutate(hostile);
		const bytes = hostileBytes(hostile);
		throws(
			() => loadArtifact(bytes, artifactDigest(bytes), expected),
			expectedError,
		);
	};

	rejectHostile((artifact) => {
		const job = artifact.phases.afterWrite.find(
			(statement: any) =>
				statement.op === "effect" && statement.value.capability === "acceptJob",
		);
		artifact.phases.check.push(job);
	}, /capability is not admitted in check/);
	rejectHostile((artifact) => {
		artifact.phases.afterWrite.push({
			op: "throwIssue",
			issue: bindings.issues.invalidName,
		});
	}, /issue throw is not admitted in afterWrite/);
	rejectHostile((artifact) => {
		const job = artifact.phases.afterWrite.find(
			(statement: any) =>
				statement.op === "effect" && statement.value.capability === "acceptJob",
		);
		job.value.arguments[0].entries[0].value = clone(
			artifact.phases.check[0].value,
		);
	}, /capability expressions must be top-level sequential statements/);
	rejectHostile((artifact) => {
		artifact.phases.normalize.push({
			op: "return",
			value: { op: "local", slot: 999 },
		});
	}, /not defined before use/);
	rejectHostile((artifact) => {
		artifact.phases.normalize[0].slot = -1;
	}, /const slot is invalid/);
	rejectHostile((artifact) => {
		const loopIndex = artifact.phases.afterWrite.findIndex(
			(statement: any) => statement.op === "forOf",
		);
		artifact.phases.afterWrite.splice(loopIndex, 0, {
			op: "const",
			slot: 999,
			value: { op: "array", values: [] },
		});
		artifact.phases.afterWrite[loopIndex + 1].sourceSlot = 999;
	}, /prior bounded read result/);
	rejectHostile((artifact) => {
		artifact.phases.normalize.splice(1, 0, {
			op: "const",
			slot: artifact.phases.normalize[0].slot,
			value: { op: "literal", value: null },
		});
	}, /already defined/);
	rejectHostile((artifact) => {
		artifact.phases.normalize.push({
			op: "return",
			value: {
				op: "object",
				entries: [
					{
						kind: "argument",
						key: "stolen",
						value: { op: "literal", value: true },
					},
				],
			},
		});
	}, /only admitted inside a capability/);
});

test("domain separation, relocation stability, tampering, and cross-build hostiles fail closed", () => {
	const artifact = compile();
	const bytes = encodeArtifact(artifact);
	const digest = artifactDigest(bytes);
	const foreignDomainDigest = new Bun.CryptoHasher("sha256")
		.update("questpie.other.v1\0")
		.update(bytes)
		.digest("hex");
	notStrictEqual(digest, foreignDomainDigest);

	const relocatedA = lowerPhase(
		"normalize",
		callbacks.normalize,
		bindings,
		"/checkout/a/src/tickets.ts",
	);
	const relocatedB = lowerPhase(
		"normalize",
		callbacks.normalize,
		bindings,
		"/tmp/relocated/src/tickets.ts",
	);
	deepStrictEqual(relocatedA, relocatedB);

	const tampered = bytes.slice();
	tampered[tampered.length - 2] ^= 1;
	throws(
		() => loadArtifact(tampered, digest, expectedContract),
		/digest mismatch/,
	);
	throws(
		() =>
			loadArtifact(bytes, digest, {
				runtimeBuild: "c".repeat(64),
				bindings,
			}),
		/compatibility binding mismatch/,
	);
	throws(
		() =>
			loadArtifact(bytes, digest, {
				runtimeBuild,
				bindings: { ...bindings, schema: "schema:other" },
			}),
		/compatibility binding mismatch/,
	);
	throws(
		() =>
			loadArtifact(bytes, digest, {
				runtimeBuild,
				bindings: { ...bindings, collection: "collection:other/tickets" },
			}),
		/compatibility binding mismatch/,
	);
	throws(
		() =>
			decodeArtifact(bytes, {
				runtimeBuild,
				bindings,
				interpreter: "questpie.lifecycle-interpreter.v2",
			}),
		/compatibility binding mismatch/,
	);

	const nonCanonical = new TextEncoder().encode(
		JSON.stringify(artifact, null, 2),
	);
	throws(
		() => decodeArtifact(nonCanonical, expectedContract),
		/not canonically encoded/,
	);
	const crossBuild = clone(artifact);
	crossBuild.runtimeBuild = "c".repeat(64);
	const crossBuildBytes = encodeArtifact(crossBuild);
	throws(
		() =>
			loadArtifact(
				crossBuildBytes,
				artifactDigest(crossBuildBytes),
				expectedContract,
			),
		/compatibility binding mismatch/,
	);
});

test("interpreter raises only bound issue identity and withholds absent capabilities", async () => {
	const artifact = compile();
	let error: unknown;
	try {
		await executePhase(
			artifact,
			"validate",
			[
				{ id: "T-1", name: "", status: "open", count: 1 },
				null,
				"2026-08-28T10:00:00.000Z",
				{},
			],
			{},
			executionBudget(),
		);
	} catch (caught) {
		error = caught;
	}
	strictEqual(error instanceof InterpretedIssue, true);
	strictEqual(
		(error as InterpretedIssue).identity,
		bindings.issues.invalidName,
	);
	await rejects(
		executePhase(
			artifact,
			"check",
			[
				{ id: "T-1", name: "ok", status: "open", count: 1 },
				null,
				"2026-08-28T10:00:00.000Z",
				{},
				{},
			],
			{},
			executionBudget(),
		),
		/withheld capability/,
	);
});

test("one outer execution budget owns statements, rows, dependencies, duration, cancellation, and artifact re-entry", async () => {
	const artifact = compile();
	const afterInputs = [
		{ id: "T-1", status: "closed" },
		null,
		"2026-08-28T10:00:00.000Z",
		{},
		"call-1",
	] as const;
	const adapter = {
		"operation:helpdesk/tickets/findRelated": () => [
			{ id: "T-2" },
			{ id: "T-3" },
		],
		"operation:helpdesk/tickets/updateRelated": () => undefined,
		"job:helpdesk/tickets/notify": () => undefined,
	};
	await rejects(
		executePhase(
			artifact,
			"afterWrite",
			afterInputs,
			adapter,
			executionBudget({ maxStatements: 1 }),
		),
		/statement budget exceeded/,
	);
	await rejects(
		executePhase(
			artifact,
			"afterWrite",
			afterInputs,
			adapter,
			executionBudget({ maxDependencies: 1 }),
		),
		/dependency budget exceeded/,
	);
	await rejects(
		executePhase(
			artifact,
			"afterWrite",
			afterInputs,
			adapter,
			executionBudget({ maxRows: 1 }),
		),
		/row budget exceeded/,
	);
	await rejects(
		executePhase(
			artifact,
			"afterWrite",
			afterInputs,
			{
				...adapter,
				"operation:helpdesk/tickets/findRelated": () => [
					{ id: "T-2" },
					{ id: "T-3" },
					{ id: "T-4" },
				],
			},
			executionBudget(),
		),
		/read cardinality binding violated/,
	);
	const controller = new AbortController();
	let writes = 0;
	await rejects(
		executePhase(
			artifact,
			"afterWrite",
			afterInputs,
			{
				...adapter,
				"operation:helpdesk/tickets/updateRelated": () => {
					writes += 1;
					controller.abort();
				},
			},
			executionBudget({ signal: controller.signal }),
		),
		(error: unknown) =>
			error instanceof DOMException && error.name === "AbortError",
	);
	strictEqual(writes, 1);
	const nestedBudget = executionBudget({ maxArtifactReentry: 2 });
	const nestedAdapter: any = {
		"operation:helpdesk/tickets/findRelated": ({ budget }: any) =>
			executePhase(
				artifact,
				"check",
				[{ id: "T-1" }, null, "2026-08-28T10:00:00.000Z", {}, {}],
				nestedAdapter,
				budget,
			),
	};
	await rejects(
		executePhase(
			artifact,
			"check",
			[{ id: "T-1" }, null, "2026-08-28T10:00:00.000Z", {}, {}],
			nestedAdapter,
			nestedBudget,
		),
		/artifact re-entry budget exceeded/,
	);
	strictEqual(nestedBudget.artifactReentry, 0);
	let now = 0;
	const duration = executionBudget({
		deadline: 100,
		maxDurationMilliseconds: 1,
		clock: () => now,
	});
	now = 2;
	await rejects(
		executePhase(artifact, "normalize", [{ name: "x", id: "1" }], {}, duration),
		/duration budget exceeded/,
	);
	const deadline = executionBudget({ deadline: 1, clock: () => now });
	await rejects(
		executePhase(artifact, "normalize", [{ name: "x", id: "1" }], {}, deadline),
		/deadline exceeded/,
	);
});
