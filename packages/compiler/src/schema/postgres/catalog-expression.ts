type JsonRecord = Readonly<Record<string, unknown>>;

export function parseCatalogDefault(
	expression: string | null,
): JsonRecord | null {
	if (expression === null) return null;
	const value = stripOuterParentheses(expression.trim());
	if (/^(?:pg_catalog\.)?gen_random_uuid\(\)$/.test(value))
		return { kind: "randomUuid" };
	if (/^(?:pg_catalog\.)?now\(\)$/.test(value)) return { kind: "now" };
	const literal = parseLiteral(value);
	return literal ? { kind: "literal", value: literal.value } : null;
}

export function parseCatalogCheck(definition: string): JsonRecord | null {
	const match = /^CHECK\s*\(([\s\S]*)\)$/i.exec(definition.trim());
	return parseExpression(match?.[1] ?? definition);
}

function parseExpression(raw: string): JsonRecord | null {
	const expression = stripOuterParentheses(raw.trim());
	for (const [word, kind] of [
		["OR", "or"],
		["AND", "and"],
	] as const) {
		const parts = splitTopLevelWord(expression, word);
		if (parts.length > 1) {
			const expressions = parts.map(parseExpression);
			return expressions.every((item) => item !== null)
				? { kind, expressions }
				: null;
		}
	}
	if (/^NOT\b/i.test(expression)) {
		const child = parseExpression(expression.replace(/^NOT\b/i, ""));
		return child ? { kind: "not", expression: child } : null;
	}
	for (const [suffix, kind] of [
		["IS NOT NULL", "isNotNull"],
		["IS NULL", "isNull"],
	] as const) {
		const start = topLevelSuffix(expression, suffix);
		if (start !== -1) {
			const child = parseOperand(expression.slice(0, start));
			return child ? { kind, expression: child } : null;
		}
	}
	for (const [operatorSql, operator] of [
		[">=", "greaterThanOrEqual"],
		["<=", "lessThanOrEqual"],
		["<>", "notEqual"],
		["=", "equal"],
		[">", "greaterThan"],
		["<", "lessThan"],
	] as const) {
		const index = topLevelOperator(expression, operatorSql);
		if (index !== -1) {
			const left = parseOperand(expression.slice(0, index));
			const right = parseOperand(expression.slice(index + operatorSql.length));
			return left && right ? { kind: "compare", operator, left, right } : null;
		}
	}
	return parseOperand(expression);
}

function parseOperand(raw: string): JsonRecord | null {
	const expression = stripOuterParentheses(raw.trim());
	const length = /^(?:pg_catalog\.)?char_length\(([\s\S]*)\)$/i.exec(
		expression,
	);
	if (length) {
		const child = parseExpression(length[1]!);
		return child ? { kind: "textLength", expression: child } : null;
	}
	const literal = parseLiteral(expression, ["text", "int8", "bigint"]);
	if (literal) return literal;
	const quoted = /^"((?:""|[^"])*)"$/.exec(expression);
	if (quoted) return { kind: "field", field: quoted[1]!.replaceAll('""', '"') };
	if (/^[a-z_][a-z0-9_$]*$/i.test(expression))
		return { kind: "field", field: expression };
	return null;
}

function parseLiteral(
	expression: string,
	allowedStringCasts: readonly string[] = ["text"],
): JsonRecord | null {
	if (/^NULL$/i.test(expression)) return { kind: "literal", value: null };
	if (/^(?:true|false)$/i.test(expression))
		return { kind: "literal", value: expression.toLowerCase() === "true" };
	if (/^-?(?:\d+|\d+\.\d+)$/.test(expression))
		return { kind: "literal", value: Number(expression) };
	const string =
		/^'((?:''|[^'])*)'(?:\s*::\s*((?:(?:pg_catalog|"pg_catalog")\.)?(?:[a-z_][a-z0-9_]*|"[a-z_][a-z0-9_]*")))?$/i.exec(
			expression,
		);
	const cast = string?.[2]
		?.replaceAll('"', "")
		.toLowerCase()
		.replace(/^pg_catalog\./, "");
	if (cast && !allowedStringCasts.includes(cast)) return null;
	return string
		? { kind: "literal", value: string[1]!.replaceAll("''", "'") }
		: null;
}

function stripOuterParentheses(value: string): string {
	let result = value;
	while (
		result.startsWith("(") &&
		matchingClose(result, 0) === result.length - 1
	)
		result = result.slice(1, -1).trim();
	return result;
}

function matchingClose(value: string, opening: number): number {
	let depth = 0;
	let singleQuoted = false;
	let doubleQuoted = false;
	for (let index = opening; index < value.length; index++) {
		const character = value[index];
		if (character === "'" && !doubleQuoted) {
			if (singleQuoted && value[index + 1] === "'") index++;
			else singleQuoted = !singleQuoted;
			continue;
		}
		if (character === '"' && !singleQuoted) {
			if (doubleQuoted && value[index + 1] === '"') index++;
			else doubleQuoted = !doubleQuoted;
			continue;
		}
		if (singleQuoted || doubleQuoted) continue;
		if (character === "(") depth++;
		if (character === ")" && --depth === 0) return index;
	}
	return -1;
}

function splitTopLevelWord(value: string, word: string): string[] {
	const indexes = topLevelMatches(value, ` ${word} `);
	if (indexes.length === 0) return [value];
	const parts: string[] = [];
	let start = 0;
	for (const index of indexes) {
		parts.push(value.slice(start, index));
		start = index + word.length + 2;
	}
	parts.push(value.slice(start));
	return parts;
}

function topLevelSuffix(value: string, suffix: string): number {
	const token = ` ${suffix}`;
	const indexes = topLevelMatches(value, token);
	const index = indexes.at(-1) ?? -1;
	return index !== -1 && index + token.length === value.length ? index : -1;
}

function topLevelOperator(value: string, operator: string): number {
	return (
		topLevelMatches(value, operator).find((index) => {
			const previous = value[index - 1];
			const next = value[index + operator.length];
			return !"<>=!".includes(previous ?? "") && !"<>=!".includes(next ?? "");
		}) ?? -1
	);
}

function topLevelMatches(value: string, token: string): number[] {
	const indexes: number[] = [];
	let depth = 0;
	let singleQuoted = false;
	let doubleQuoted = false;
	for (let index = 0; index <= value.length - token.length; index++) {
		const character = value[index];
		if (character === "'" && !doubleQuoted) {
			if (singleQuoted && value[index + 1] === "'") index++;
			else singleQuoted = !singleQuoted;
			continue;
		}
		if (character === '"' && !singleQuoted) {
			if (doubleQuoted && value[index + 1] === '"') index++;
			else doubleQuoted = !doubleQuoted;
			continue;
		}
		if (singleQuoted || doubleQuoted) continue;
		if (character === "(") depth++;
		else if (character === ")") depth--;
		if (depth === 0 && value.slice(index, index + token.length) === token)
			indexes.push(index);
	}
	return indexes;
}
