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
		}),
		"data.related.update": Object.freeze({
			kind: "write",
			identity: "operation:helpdesk/tickets/updateRelated",
		}),
		"jobs.ticket.notify.accept": Object.freeze({
			kind: "acceptJob",
			identity: "job:helpdesk/tickets/notify",
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
		await ctx.jobs.ticket.notify.accept({ id: row.id, occurredAt: ctx.now });
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
		await executePhase(artifact, "normalize", [
			{ id: "T-1", name: "  HELLO  ", status: "open", count: 1 },
		]),
		{ id: "T-1", name: "HELLO", status: "open", count: 1 },
	);
	deepStrictEqual(
		await executePhase(artifact, "validate", [
			{ id: "T-1", name: "ok", status: "open", count: 1 },
			null,
			"2026-08-28T10:00:00.000Z",
			{},
		]),
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
		],
		{
			"operation:helpdesk/tickets/findRelated": () => [
				{ id: "T-2" },
				{ id: "T-3" },
			],
			"operation:helpdesk/tickets/updateRelated": (input) =>
				effects.push(`write:${(input as any).id}`),
			"job:helpdesk/tickets/notify": (input) =>
				effects.push(`job:${(input as any).id}`),
		},
	);
	deepStrictEqual(effects, ["write:T-2", "write:T-3", "job:T-1"]);
	strictEqual(invocations, 0);
});

test("Lifecycle Program v1 accepted grammar has executable coverage", () => {
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
		"118bf6ab161c7e01c5cbc0688bf4f1d83d16b38ee07dc198711f46042ca4d7fb",
	);
	const expected = {
		runtimeBuild,
		schema: bindings.schema,
		collection: bindings.collection,
	} as const;
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

test("recomputed digests cannot bypass phase, sequential-effect, issue, or slot closure", () => {
	const expected = {
		runtimeBuild,
		schema: bindings.schema,
		collection: bindings.collection,
	} as const;
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
		() =>
			loadArtifact(tampered, digest, {
				runtimeBuild,
				schema: bindings.schema,
				collection: bindings.collection,
			}),
		/digest mismatch/,
	);
	throws(
		() =>
			loadArtifact(bytes, digest, {
				runtimeBuild: "c".repeat(64),
				schema: bindings.schema,
				collection: bindings.collection,
			}),
		/compatibility binding mismatch/,
	);
	throws(
		() =>
			loadArtifact(bytes, digest, {
				runtimeBuild,
				schema: "schema:other",
				collection: bindings.collection,
			}),
		/compatibility binding mismatch/,
	);
	throws(
		() =>
			loadArtifact(bytes, digest, {
				runtimeBuild,
				schema: bindings.schema,
				collection: "collection:other/tickets",
			}),
		/compatibility binding mismatch/,
	);
	throws(
		() =>
			decodeArtifact(bytes, {
				runtimeBuild,
				schema: bindings.schema,
				collection: bindings.collection,
				interpreter: "questpie.lifecycle-interpreter.v2",
			}),
		/compatibility binding mismatch/,
	);

	const nonCanonical = new TextEncoder().encode(
		JSON.stringify(artifact, null, 2),
	);
	throws(
		() =>
			decodeArtifact(nonCanonical, {
				runtimeBuild,
				schema: bindings.schema,
				collection: bindings.collection,
			}),
		/not canonically encoded/,
	);
	const crossBuild = clone(artifact);
	crossBuild.runtimeBuild = "c".repeat(64);
	const crossBuildBytes = encodeArtifact(crossBuild);
	throws(
		() =>
			loadArtifact(crossBuildBytes, artifactDigest(crossBuildBytes), {
				runtimeBuild,
				schema: bindings.schema,
				collection: bindings.collection,
			}),
		/compatibility binding mismatch/,
	);
});

test("interpreter raises only bound issue identity and withholds absent capabilities", async () => {
	const artifact = compile();
	let error: unknown;
	try {
		await executePhase(artifact, "validate", [
			{ id: "T-1", name: "", status: "open", count: 1 },
			null,
			"2026-08-28T10:00:00.000Z",
			{},
		]);
	} catch (caught) {
		error = caught;
	}
	strictEqual(error instanceof InterpretedIssue, true);
	strictEqual(
		(error as InterpretedIssue).identity,
		bindings.issues.invalidName,
	);
	await rejects(
		executePhase(artifact, "check", [
			{ id: "T-1", name: "ok", status: "open", count: 1 },
			null,
			"2026-08-28T10:00:00.000Z",
			{},
			{},
		]),
		/withheld capability/,
	);
});
