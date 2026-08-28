import { compareAscii } from "../canonical";

type CodecContract = Readonly<Record<string, unknown>>;

export type CodecContractProblem = Readonly<{
	kind:
		| "notObject"
		| "unexpectedMember"
		| "missingMember"
		| "invalidKindType"
		| "invalidMember"
		| "nonCanonicalBigint"
		| "bigintOutsidePostgres"
		| "invalidRange"
		| "optionalPresence"
		| "optionalPosition"
		| "unsupportedKind";
	path: readonly string[];
	member?: string;
	codecKind?: string;
}>;

export interface CodecContractBoundary {
	readonly allowOptionalPresenceMember?: boolean;
	readonly requireExactMembers?: boolean;
	invalid(problem: CodecContractProblem): never;
}

/** Owns normalization and validation for the closed Operation codec grammar. */
export function normalizeCodecContract(
	value: unknown,
	boundary: CodecContractBoundary,
	options: Readonly<{
		optionalAllowed?: boolean;
		path?: readonly string[];
	}> = {},
): CodecContract {
	const path = options.path ?? [];
	if (!value || typeof value !== "object" || Array.isArray(value))
		return boundary.invalid({ kind: "notObject", path });
	const codec = value as Readonly<Record<string, unknown>>;
	const invalid = (problem: Omit<CodecContractProblem, "path">): never =>
		boundary.invalid({ ...problem, path });
	const exactKeys = (allowed: readonly string[], allRequired = false): void => {
		const unexpected = Object.keys(codec)
			.filter((key) => !allowed.includes(key))
			.sort(compareAscii)[0];
		if (unexpected !== undefined)
			invalid({ kind: "unexpectedMember", member: unexpected });
		if (allRequired && boundary.requireExactMembers) {
			const missing = allowed.find((key) => !Object.hasOwn(codec, key));
			if (missing !== undefined)
				invalid({ kind: "missingMember", member: missing });
		}
	};
	const safeInteger = (
		raw: unknown,
		member: string,
		minimum: number,
		maximum = Number.MAX_SAFE_INTEGER,
	): number => {
		if (
			typeof raw !== "number" ||
			!Number.isSafeInteger(raw) ||
			raw < minimum ||
			raw > maximum
		)
			invalid({ kind: "invalidMember", member });
		return raw as number;
	};
	const child = (
		childValue: unknown,
		member: string,
		optionalAllowed = false,
	): CodecContract =>
		normalizeCodecContract(childValue, boundary, {
			optionalAllowed,
			path: [...path, member],
		});

	if (codec.kind === "object") {
		exactKeys(["kind", "properties"], true);
		if (
			!codec.properties ||
			typeof codec.properties !== "object" ||
			Array.isArray(codec.properties)
		)
			return boundary.invalid({
				kind: "notObject",
				path: [...path, "properties"],
			});
		const properties = Object.fromEntries(
			Object.entries(codec.properties)
				.sort(([left], [right]) => compareAscii(left, right))
				.map(([key, property]) => [
					key,
					child(property, `properties.${key}`, true),
				]),
		);
		return { kind: "object", properties };
	}
	if (codec.kind === "array") {
		exactKeys(["kind", "items", "maximum"]);
		const maximum =
			codec.maximum === undefined
				? undefined
				: safeInteger(codec.maximum, "maximum", 1);
		return {
			kind: "array",
			items: child(codec.items, "items"),
			...(maximum === undefined ? {} : { maximum }),
		};
	}
	if (codec.kind === "nullable") {
		exactKeys(["kind", "codec"], true);
		return { kind: "nullable", codec: child(codec.codec, "codec") };
	}
	if (codec.kind === "optional") {
		exactKeys(
			boundary.allowOptionalPresenceMember
				? ["kind", "presence", "codec"]
				: ["kind", "codec"],
			true,
		);
		if (codec.presence !== undefined && codec.presence !== "optional")
			invalid({ kind: "optionalPresence", member: "presence" });
		if (!options.optionalAllowed) invalid({ kind: "optionalPosition" });
		return { kind: "optional", codec: child(codec.codec, "codec") };
	}

	if (typeof codec.kind !== "string") invalid({ kind: "invalidKindType" });
	const kind = codec.kind as string;
	if (["boolean", "cursor", "date", "json", "uuid"].includes(kind)) {
		exactKeys(["kind"], true);
		return { kind };
	}
	if (kind === "text") {
		exactKeys(["kind", "minLength", "maxLength"]);
		const minLength =
			codec.minLength === undefined
				? undefined
				: safeInteger(codec.minLength, "minLength", 0);
		const maxLength =
			codec.maxLength === undefined
				? undefined
				: safeInteger(codec.maxLength, "maxLength", 0);
		if (
			minLength !== undefined &&
			maxLength !== undefined &&
			minLength > maxLength
		)
			invalid({ kind: "invalidRange", codecKind: kind });
		return {
			kind,
			...(minLength === undefined ? {} : { minLength }),
			...(maxLength === undefined ? {} : { maxLength }),
		};
	}
	if (kind === "integer") {
		exactKeys(["kind", "minimum", "maximum"]);
		const minimum =
			codec.minimum === undefined
				? undefined
				: safeInteger(codec.minimum, "minimum", Number.MIN_SAFE_INTEGER);
		const maximum =
			codec.maximum === undefined
				? undefined
				: safeInteger(codec.maximum, "maximum", Number.MIN_SAFE_INTEGER);
		if (minimum !== undefined && maximum !== undefined && minimum > maximum)
			invalid({ kind: "invalidRange", codecKind: kind });
		return {
			kind,
			...(minimum === undefined ? {} : { minimum }),
			...(maximum === undefined ? {} : { maximum }),
		};
	}
	if (kind === "bigint") {
		exactKeys(["kind", "minimum", "maximum"]);
		const bound = (raw: unknown, member: string): string | undefined => {
			if (raw === undefined) return undefined;
			if (
				typeof raw !== "string" ||
				!/^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$/u.test(raw)
			)
				invalid({ kind: "nonCanonicalBigint", member });
			const canonical = raw as string;
			const parsed = BigInt(canonical);
			if (
				parsed < -9_223_372_036_854_775_808n ||
				parsed > 9_223_372_036_854_775_807n
			)
				invalid({ kind: "bigintOutsidePostgres", member });
			return canonical;
		};
		const minimum = bound(codec.minimum, "minimum");
		const maximum = bound(codec.maximum, "maximum");
		if (
			minimum !== undefined &&
			maximum !== undefined &&
			BigInt(minimum) > BigInt(maximum)
		)
			invalid({ kind: "invalidRange", codecKind: kind });
		return {
			kind,
			...(minimum === undefined ? {} : { minimum }),
			...(maximum === undefined ? {} : { maximum }),
		};
	}
	if (kind === "numeric") {
		exactKeys(["kind", "precision", "scale"], true);
		const precision = safeInteger(codec.precision, "precision", 1, 1_000);
		const scale = safeInteger(codec.scale, "scale", 0, precision);
		return { kind, precision, scale };
	}
	if (kind === "timestamp") {
		exactKeys(["kind", "withTimezone"]);
		if (
			codec.withTimezone !== undefined &&
			typeof codec.withTimezone !== "boolean"
		)
			invalid({ kind: "invalidMember", member: "withTimezone" });
		return {
			kind,
			...(codec.withTimezone === undefined
				? {}
				: { withTimezone: codec.withTimezone }),
		};
	}
	return invalid({ kind: "unsupportedKind", codecKind: kind });
}
