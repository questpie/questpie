import { createHash } from "node:crypto";

export type CursorScalar = boolean | number | string | null;

export type CursorScalarCodec =
	| "bigint"
	| "boolean"
	| "date"
	| "integer"
	| "numeric"
	| "text"
	| "timestamp"
	| "uuid";

export type CursorOrderTerm = Readonly<{
	field: `collection:${string}/field:${string}`;
	codec: CursorScalarCodec;
	nullable: boolean;
	withTimezone?: boolean;
	minimum?: number | string | null;
	maximum?: number | string | null;
	precision?: number;
	scale?: number;
}>;

export type UsedExecutionFacts = Readonly<{
	authorityKind?: "ordinary" | "system";
	principalId?: string;
	tenantId?: string;
}>;

export type DataCursorDiagnosticCode =
	| "QP-DATA-010"
	| "QP-DATA-011"
	| "QP-DATA-013";

export class DataCursorBindingError extends Error {
	readonly blocking = "none" as const;
	readonly phase = "bind" as const;
	readonly diagnosticClass:
		| "cursorScopeMismatch"
		| "cursorTemplateMismatch"
		| "invalidCursor";

	constructor(readonly code: DataCursorDiagnosticCode) {
		const diagnosticClass =
			code === "QP-DATA-010"
				? "invalidCursor"
				: code === "QP-DATA-011"
					? "cursorTemplateMismatch"
					: "cursorScopeMismatch";
		super(diagnosticClass);
		this.name = "DataCursorBindingError";
		this.diagnosticClass = diagnosticClass;
	}
}

type PolicyCursorScopeV1 = Readonly<{
	format: "questpie.policy-cursor-scope";
	version: 1;
	policyProgramDigest: string;
	usedExecutionFacts: UsedExecutionFacts;
}>;

type DataCursorV2 = Readonly<{
	format: "questpie.data-cursor";
	version: 2;
	templateDigest: string;
	scopeDigest: string;
	policyScopeDigest: string;
	order: readonly Readonly<{
		field: `collection:${string}/field:${string}`;
		value: CursorScalar;
	}>[];
}>;

const digestPattern = /^[0-9a-f]{64}$/;
const uuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function hasLoneUnicodeSurrogate(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
			index += 1;
			continue;
		}
		if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) return true;
	}
	return false;
}

function quote(value: string): string {
	if (hasLoneUnicodeSurrogate(value)) throw new TypeError("invalid Unicode");
	return JSON.stringify(value);
}

function scalar(value: CursorScalar): string {
	if (typeof value === "string") return quote(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value) || Object.is(value, -0))
			throw new TypeError("invalid number");
	}
	return JSON.stringify(value);
}

// These two renderers are intentionally closed to their versioned protocols.
// They are not a second general-purpose canonical JSON implementation.
function encodePolicyCursorScopeV1(scope: PolicyCursorScopeV1): string {
	const facts: string[] = [];
	if (scope.usedExecutionFacts.authorityKind !== undefined)
		facts.push(
			`"authorityKind":${quote(scope.usedExecutionFacts.authorityKind)}`,
		);
	if (scope.usedExecutionFacts.principalId !== undefined)
		facts.push(`"principalId":${quote(scope.usedExecutionFacts.principalId)}`);
	if (scope.usedExecutionFacts.tenantId !== undefined)
		facts.push(`"tenantId":${quote(scope.usedExecutionFacts.tenantId)}`);
	return `{"format":"questpie.policy-cursor-scope","policyProgramDigest":${quote(scope.policyProgramDigest)},"usedExecutionFacts":{${facts.join(",")}},"version":1}\n`;
}

function encodeDataCursorV2(cursor: DataCursorV2): string {
	const order = cursor.order
		.map(
			(item) => `{"field":${quote(item.field)},"value":${scalar(item.value)}}`,
		)
		.join(",");
	return `{"format":"questpie.data-cursor","order":[${order}],"policyScopeDigest":${quote(cursor.policyScopeDigest)},"scopeDigest":${quote(cursor.scopeDigest)},"templateDigest":${quote(cursor.templateDigest)},"version":2}\n`;
}

function sha256(domain: string, bytes: string): string {
	return createHash("sha256").update(`${domain}\0`).update(bytes).digest("hex");
}

function exactKeys(
	value: Readonly<Record<string, unknown>>,
	keys: string[],
): boolean {
	const actual = Object.keys(value).sort();
	return (
		actual.length === keys.length &&
		actual.every((key, index) => key === keys[index])
	);
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Readonly<Record<string, unknown>>)
		: null;
}

function validTimestamp(value: string, withTimezone: boolean): boolean {
	const pattern = withTimezone
		? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
		: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}$/;
	if (!pattern.test(value)) return false;
	const comparable = withTimezone ? value : `${value}Z`;
	return new Date(comparable).toISOString() === comparable;
}

function validScalar(
	value: unknown,
	term: CursorOrderTerm,
): value is CursorScalar {
	if (value === null) return term.nullable;
	if (term.codec === "boolean") return typeof value === "boolean";
	if (term.codec === "integer")
		return (
			typeof value === "number" &&
			Number.isSafeInteger(value) &&
			!Object.is(value, -0) &&
			(typeof term.minimum !== "number" || value >= term.minimum) &&
			(typeof term.maximum !== "number" || value <= term.maximum)
		);
	if (typeof value !== "string" || hasLoneUnicodeSurrogate(value)) return false;
	if (term.codec === "uuid") return uuidPattern.test(value);
	if (term.codec === "bigint") {
		if (!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(value)) return false;
		const parsed = BigInt(value);
		return (
			parsed >= -9_223_372_036_854_775_808n &&
			parsed <= 9_223_372_036_854_775_807n &&
			(typeof term.minimum !== "string" || parsed >= BigInt(term.minimum)) &&
			(typeof term.maximum !== "string" || parsed <= BigInt(term.maximum))
		);
	}
	if (term.codec === "numeric") {
		if (typeof term.precision !== "number" || typeof term.scale !== "number")
			return false;
		const pattern =
			term.scale === 0
				? /^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/
				: new RegExp(`^(?:0|-[1-9][0-9]*|[1-9][0-9]*)\\.[0-9]{${term.scale}}$`);
		return (
			pattern.test(value) && value.replace(/[-.]/g, "").length <= term.precision
		);
	}
	if (term.codec === "date") {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
		return (
			new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
		);
	}
	if (term.codec === "timestamp")
		return validTimestamp(value, term.withTimezone === true);
	return value.normalize("NFC") === value;
}

export type CursorFailure =
	| Readonly<{ kind: "invalid" }>
	| Readonly<{ kind: "scopeMismatch" }>
	| Readonly<{ kind: "templateMismatch" }>;

export function createCursorCodecV2(
	input: Readonly<{
		templateDigest: string;
		scopeDigest: string;
		policyProgramDigest: string;
		usedExecutionFacts: UsedExecutionFacts;
		order: readonly CursorOrderTerm[];
	}>,
): Readonly<{
	policyScopeBytes: string;
	policyScopeDigest: string;
	decode(token: string): readonly CursorScalar[] | CursorFailure;
	encode(values: readonly CursorScalar[]): string;
}> {
	if (
		typeof input.templateDigest !== "string" ||
		!digestPattern.test(input.templateDigest) ||
		typeof input.scopeDigest !== "string" ||
		!digestPattern.test(input.scopeDigest) ||
		typeof input.policyProgramDigest !== "string" ||
		!digestPattern.test(input.policyProgramDigest) ||
		input.order.length === 0
	)
		throw new TypeError("invalid compiled cursor binding");
	const factKeys = Object.keys(input.usedExecutionFacts).sort();
	const hasUnknownFact = factKeys.some(
		(key) => !["authorityKind", "principalId", "tenantId"].includes(key),
	);
	const hasUndefinedFact = factKeys.some(
		(key) =>
			input.usedExecutionFacts[key as keyof UsedExecutionFacts] === undefined,
	);
	const hasInvalidAuthorityKind =
		input.usedExecutionFacts.authorityKind !== undefined &&
		input.usedExecutionFacts.authorityKind !== "ordinary" &&
		input.usedExecutionFacts.authorityKind !== "system";
	const hasInvalidStringFact = ["principalId", "tenantId"].some((key) => {
		const value = input.usedExecutionFacts[key as "principalId" | "tenantId"];
		return (
			value !== undefined &&
			(typeof value !== "string" || hasLoneUnicodeSurrogate(value))
		);
	});
	if (
		hasUnknownFact ||
		hasUndefinedFact ||
		hasInvalidAuthorityKind ||
		hasInvalidStringFact
	)
		throw new TypeError("invalid compiled Policy cursor scope");
	const scope: PolicyCursorScopeV1 = {
		format: "questpie.policy-cursor-scope",
		version: 1,
		policyProgramDigest: input.policyProgramDigest,
		usedExecutionFacts: input.usedExecutionFacts,
	};
	const policyScopeBytes = encodePolicyCursorScopeV1(scope);
	const policyScopeDigest = sha256(
		"questpie-policy-cursor-scope-v1",
		policyScopeBytes,
	);

	const encode = (values: readonly CursorScalar[]): string => {
		if (
			values.length !== input.order.length ||
			values.some((value, index) => {
				const term = input.order[index];
				return !term || !validScalar(value, term);
			})
		)
			throw new TypeError("invalid cursor order values");
		const cursor: DataCursorV2 = {
			format: "questpie.data-cursor",
			version: 2,
			templateDigest: input.templateDigest,
			scopeDigest: input.scopeDigest,
			policyScopeDigest,
			order: input.order.map((term, index) => ({
				field: term.field,
				value: values[index]!,
			})),
		};
		const token = Buffer.from(encodeDataCursorV2(cursor)).toString("base64url");
		if (token.length > 2_048)
			throw new TypeError("cursor exceeds maximum size");
		return token;
	};

	const decode = (token: string): readonly CursorScalar[] | CursorFailure => {
		if (
			token.length === 0 ||
			token.length > 2_048 ||
			!/^[A-Za-z0-9_-]+$/.test(token) ||
			token.length % 4 === 1
		)
			return { kind: "invalid" };
		let bytes: Uint8Array;
		let text: string;
		try {
			bytes = Buffer.from(token, "base64url");
			if (Buffer.from(bytes).toString("base64url") !== token)
				return { kind: "invalid" };
			text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			return { kind: "invalid" };
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(text);
		} catch {
			return { kind: "invalid" };
		}
		const cursor = record(parsed);
		if (
			!cursor ||
			!exactKeys(cursor, [
				"format",
				"order",
				"policyScopeDigest",
				"scopeDigest",
				"templateDigest",
				"version",
			]) ||
			cursor.format !== "questpie.data-cursor" ||
			cursor.version !== 2 ||
			typeof cursor.templateDigest !== "string" ||
			!digestPattern.test(cursor.templateDigest) ||
			typeof cursor.scopeDigest !== "string" ||
			!digestPattern.test(cursor.scopeDigest) ||
			typeof cursor.policyScopeDigest !== "string" ||
			!digestPattern.test(cursor.policyScopeDigest) ||
			!Array.isArray(cursor.order) ||
			cursor.order.length !== input.order.length
		)
			return { kind: "invalid" };
		const values: CursorScalar[] = [];
		const normalizedOrder: DataCursorV2["order"][number][] = [];
		for (const [index, rawItem] of cursor.order.entries()) {
			const item = record(rawItem);
			const term = input.order[index];
			if (
				!item ||
				!term ||
				!exactKeys(item, ["field", "value"]) ||
				item.field !== term.field ||
				!validScalar(item.value, term)
			)
				return { kind: "invalid" };
			values.push(item.value);
			normalizedOrder.push({ field: term.field, value: item.value });
		}
		const normalized: DataCursorV2 = {
			format: "questpie.data-cursor",
			version: 2,
			templateDigest: cursor.templateDigest,
			scopeDigest: cursor.scopeDigest,
			policyScopeDigest: cursor.policyScopeDigest,
			order: normalizedOrder,
		};
		if (encodeDataCursorV2(normalized) !== text) return { kind: "invalid" };
		if (normalized.templateDigest !== input.templateDigest)
			return { kind: "templateMismatch" };
		if (
			normalized.scopeDigest !== input.scopeDigest ||
			normalized.policyScopeDigest !== policyScopeDigest
		)
			return { kind: "scopeMismatch" };
		return Object.freeze(values);
	};

	return Object.freeze({
		policyScopeBytes,
		policyScopeDigest,
		decode,
		encode,
	});
}

export function createCursorBindingV2(
	input: Readonly<{
		templateDigest: string;
		scopeDigest: string;
		policyProgramDigest: string;
		usedExecutionFacts: UsedExecutionFacts;
		order: readonly CursorOrderTerm[];
	}>,
): Readonly<{
	policyScopeBytes: string;
	policyScopeDigest: string;
	encode(values: readonly CursorScalar[]): string;
	execute<Result>(
		after: string | null,
		adapter: (boundary: readonly CursorScalar[] | null) => Result,
	): Result;
}> {
	const codec = createCursorCodecV2(input);
	return Object.freeze({
		policyScopeBytes: codec.policyScopeBytes,
		policyScopeDigest: codec.policyScopeDigest,
		encode: codec.encode,
		execute: <Result>(
			after: string | null,
			adapter: (boundary: readonly CursorScalar[] | null) => Result,
		): Result => {
			if (after === null) return adapter(null);
			const decoded = codec.decode(after);
			if ("kind" in decoded) {
				if (decoded.kind === "templateMismatch")
					throw new DataCursorBindingError("QP-DATA-011");
				if (decoded.kind === "scopeMismatch")
					throw new DataCursorBindingError("QP-DATA-013");
				throw new DataCursorBindingError("QP-DATA-010");
			}
			return adapter(decoded);
		},
	});
}
