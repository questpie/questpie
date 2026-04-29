#!/usr/bin/env node
/**
 * Migrate V1 field calls to V2 chain syntax in test files.
 * Handles: text, textarea, email, url, number, boolean, json, datetime, date, time,
 *          richText, select, relation, object, array
 */
import { readFileSync, writeFileSync, existsSync } from "fs";

const files = [
	"packages/questpie/test/migration/migrations.test.ts",
	"packages/questpie/test/openapi/openapi-schema.test.ts",
	"packages/questpie/test/search/search-access.test.ts",
	"packages/questpie/test/search/search-adapter.test.ts",
	"packages/questpie/test/search/search-facets.test.ts",
	"packages/questpie/test/search/search-schema-integration.test.ts",
	"packages/questpie/test/types/collection-builder.test-d.ts",
	"packages/questpie/test/types/config-builder.test-d.ts",
	"packages/questpie/test/types/crud-deep-typesafety.test-d.ts",
	"packages/questpie/test/types/crud-types.test-d.ts",
	"packages/questpie/test/types/shared-type-utils.test-d.ts",
	"packages/questpie/test/types/unified-api-types.test-d.ts",
	"packages/questpie/test/unit/nested-localization-schema.test.ts",
	"packages/questpie/test/utils/mocks/mock-app-builder.ts",
];

// ============================================================================
// Balanced parsing helpers
// ============================================================================

function findMatchingBrace(str, start) {
	let depth = 0,
		i = start;
	let inString = false,
		stringChar = "",
		escaped = false;
	while (i < str.length) {
		const ch = str[i];
		if (escaped) {
			escaped = false;
			i++;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			i++;
			continue;
		}
		if (inString) {
			if (ch === stringChar) inString = false;
			else if (stringChar === "`" && ch === "$" && str[i + 1] === "{") {
				i += 2;
				let bd = 1;
				while (i < str.length && bd > 0) {
					if (str[i] === "{") bd++;
					else if (str[i] === "}") bd--;
					if (bd > 0) i++;
				}
			}
			i++;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			inString = true;
			stringChar = ch;
			i++;
			continue;
		}
		if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) return i + 1;
		}
		i++;
	}
	return -1;
}

function findMatchingParen(str, start) {
	let depth = 0,
		i = start;
	let inString = false,
		stringChar = "",
		escaped = false;
	while (i < str.length) {
		const ch = str[i];
		if (escaped) {
			escaped = false;
			i++;
			continue;
		}
		if (ch === "\\") {
			escaped = true;
			i++;
			continue;
		}
		if (inString) {
			if (ch === stringChar) inString = false;
			else if (stringChar === "`" && ch === "$" && str[i + 1] === "{") {
				i += 2;
				let bd = 1;
				while (i < str.length && bd > 0) {
					if (str[i] === "{") bd++;
					else if (str[i] === "}") bd--;
					if (bd > 0) i++;
				}
			}
			i++;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			inString = true;
			stringChar = ch;
			i++;
			continue;
		}
		if (ch === "(") depth++;
		else if (ch === ")") {
			depth--;
			if (depth === 0) return i + 1;
		}
		i++;
	}
	return -1;
}

function findMatchingBracket(str, start) {
	let depth = 0,
		i = start;
	let inString = false,
		stringChar = "";
	while (i < str.length) {
		const ch = str[i];
		if (inString) {
			if (ch === stringChar && str[i - 1] !== "\\") inString = false;
			i++;
			continue;
		}
		if (ch === '"' || ch === "'" || ch === "`") {
			inString = true;
			stringChar = ch;
			i++;
			continue;
		}
		if (ch === "[") depth++;
		else if (ch === "]") {
			depth--;
			if (depth === 0) return i + 1;
		}
		i++;
	}
	return -1;
}

// ============================================================================
// Object literal parser
// ============================================================================

function parseObjectLiteral(str) {
	const pairs = [];
	let i = 0;
	while (i < str.length) {
		while (i < str.length && /[\s,]/.test(str[i])) i++;
		if (i >= str.length) break;

		// Read key
		let key = "";
		if (str[i] === '"' || str[i] === "'") {
			const q = str[i];
			i++;
			while (i < str.length && str[i] !== q) {
				key += str[i];
				i++;
			}
			i++;
		} else {
			while (i < str.length && /[a-zA-Z0-9_$]/.test(str[i])) {
				key += str[i];
				i++;
			}
		}
		if (!key) break;

		while (i < str.length && /\s/.test(str[i])) i++;
		if (str[i] !== ":") return null;
		i++;
		while (i < str.length && /\s/.test(str[i])) i++;

		// Read value
		let rawValue = "";
		if (str[i] === "{") {
			const end = findMatchingBrace(str, i);
			if (end === -1) return null;
			rawValue = str.slice(i, end);
			i = end;
		} else if (str[i] === "[") {
			const end = findMatchingBracket(str, i);
			if (end === -1) return null;
			rawValue = str.slice(i, end);
			i = end;
			// Check for "as const" after array
			const afterArr = str.slice(i).match(/^\s*as\s+const/);
			if (afterArr) {
				rawValue += afterArr[0];
				i += afterArr[0].length;
			}
		} else if (str[i] === '"' || str[i] === "'" || str[i] === "`") {
			const q = str[i];
			i++;
			let s = "";
			while (i < str.length && str[i] !== q) {
				if (str[i] === "\\") {
					s += str[i] + str[i + 1];
					i += 2;
				} else {
					s += str[i];
					i++;
				}
			}
			rawValue = q + s + q;
			i++;
		} else if (str[i] === "(") {
			// Function expression
			const end = findMatchingParen(str, i);
			if (end === -1) return null;
			rawValue = str.slice(i, end);
			i = end;
			// Check for arrow => body
			let j = i;
			while (j < str.length && /\s/.test(str[j])) j++;
			if (str.slice(j, j + 2) === "=>") {
				j += 2;
				while (j < str.length && /\s/.test(str[j])) j++;
				if (str[j] === "{") {
					const bodyEnd = findMatchingBrace(str, j);
					if (bodyEnd === -1) return null;
					rawValue = str.slice(i - (end - i), bodyEnd);
					// Redo: the full function is from the paren start
					rawValue = str.slice(i - rawValue.length + rawValue.length, bodyEnd);
					// Let's just take it from the start of paren
					const parenStart = rawValue.length; // wrong approach, let's redo
				} else {
					// Expression body
					let exprEnd = j,
						depth = 0;
					let inStr = false,
						strCh = "";
					while (exprEnd < str.length) {
						const c = str[exprEnd];
						if (inStr) {
							if (c === strCh) inStr = false;
							exprEnd++;
							continue;
						}
						if (c === '"' || c === "'" || c === "`") {
							inStr = true;
							strCh = c;
							exprEnd++;
							continue;
						}
						if (c === "(" || c === "[" || c === "{") depth++;
						else if (c === ")" || c === "]" || c === "}") {
							if (depth === 0) break;
							depth--;
						} else if (c === "," && depth === 0) break;
						exprEnd++;
					}
					rawValue = str.slice(i - (end - i) - 0, exprEnd).trimEnd();
				}
				// Actually this is getting too complex for arrow functions inline. Let's use a simpler approach:
				// Re-parse from the opening paren position
				rawValue = str.slice(i - (end - i), end); // This gives us back the paren group
				i = end; // Reset
				// Look ahead for =>
				let k = i;
				while (k < str.length && /\s/.test(str[k])) k++;
				if (str.slice(k, k + 2) === "=>") {
					k += 2;
					while (k < str.length && /\s/.test(str[k])) k++;
					if (str[k] === "{") {
						const bodyEnd = findMatchingBrace(str, k);
						if (bodyEnd !== -1) {
							rawValue = str.slice(i - (end - i), bodyEnd);
							i = bodyEnd;
						}
					} else if (str[k] === "(") {
						const bodyEnd = findMatchingParen(str, k);
						if (bodyEnd !== -1) {
							rawValue = str.slice(i - (end - i), bodyEnd);
							i = bodyEnd;
						}
					} else {
						// Expression body
						let exprEnd = k,
							depth = 0;
						while (exprEnd < str.length) {
							const c = str[exprEnd];
							if (c === "(" || c === "[" || c === "{") depth++;
							else if (c === ")" || c === "]" || c === "}") {
								if (depth === 0) break;
								depth--;
							} else if (c === "," && depth === 0) break;
							exprEnd++;
						}
						rawValue = str.slice(i - (end - i), exprEnd).trimEnd();
						i = exprEnd;
					}
				}
			}
		} else {
			// Other value (number, boolean, identifier, f.xxx(), etc.)
			let j = i,
				depth = 0;
			let inStr = false,
				strCh = "";
			while (j < str.length) {
				const ch = str[j];
				if (inStr) {
					if (ch === strCh) inStr = false;
					j++;
					continue;
				}
				if (ch === '"' || ch === "'" || ch === "`") {
					inStr = true;
					strCh = ch;
					j++;
					continue;
				}
				if (ch === "(" || ch === "[" || ch === "{") depth++;
				else if (ch === ")" || ch === "]" || ch === "}") {
					if (depth === 0) break;
					depth--;
				} else if (ch === "," && depth === 0) break;
				j++;
			}
			rawValue = str.slice(i, j).trim();
			i = j;
		}

		pairs.push({ key, rawValue });
		while (i < str.length && /[\s,]/.test(str[i])) i++;
	}
	return pairs;
}

// ============================================================================
// Build V2 chain from parsed pairs
// ============================================================================

function buildChain(fieldType, pairs) {
	const pairMap = new Map(pairs.map((p) => [p.key, p.rawValue]));

	let baseArg = "";
	const chains = [];

	// Field-type-specific first arguments
	if (fieldType === "text" || fieldType === "email" || fieldType === "url") {
		if (pairMap.has("maxLength")) {
			baseArg = pairMap.get("maxLength");
			pairMap.delete("maxLength");
		}
	} else if (fieldType === "select") {
		if (pairMap.has("options")) {
			baseArg = pairMap.get("options");
			pairMap.delete("options");
		}
	} else if (fieldType === "relation") {
		if (pairMap.has("to")) {
			baseArg = pairMap.get("to");
			pairMap.delete("to");
		}
	}

	// Handle hasMany/manyToMany before other chains
	const isHasMany = pairMap.get("hasMany") === "true";
	if (isHasMany && pairMap.has("through")) {
		const parts = [`through: ${pairMap.get("through")}`];
		if (pairMap.has("sourceField")) {
			parts.push(`sourceField: ${pairMap.get("sourceField")}`);
			pairMap.delete("sourceField");
		}
		if (pairMap.has("targetField")) {
			parts.push(`targetField: ${pairMap.get("targetField")}`);
			pairMap.delete("targetField");
		}
		if (pairMap.has("relationName")) {
			parts.push(`relationName: ${pairMap.get("relationName")}`);
			pairMap.delete("relationName");
		}
		chains.push(`.manyToMany({ ${parts.join(", ")} })`);
		pairMap.delete("hasMany");
		pairMap.delete("through");
	} else if (isHasMany && pairMap.has("foreignKey")) {
		const parts = [`foreignKey: ${pairMap.get("foreignKey")}`];
		if (pairMap.has("onDelete")) {
			parts.push(`onDelete: ${pairMap.get("onDelete")}`);
			pairMap.delete("onDelete");
		}
		if (pairMap.has("relationName")) {
			parts.push(`relationName: ${pairMap.get("relationName")}`);
			pairMap.delete("relationName");
		}
		chains.push(`.hasMany({ ${parts.join(", ")} })`);
		pairMap.delete("hasMany");
		pairMap.delete("foreignKey");
	} else if (isHasMany) {
		pairMap.delete("hasMany");
	}

	// Process remaining props
	for (const [key, val] of pairMap) {
		switch (key) {
			case "required":
				if (val === "true") chains.push(".required()");
				break;
			case "default":
				chains.push(`.default(${val})`);
				break;
			case "label":
				chains.push(`.label(${val})`);
				break;
			case "description":
				chains.push(`.description(${val})`);
				break;
			case "localized":
				if (val === "true") chains.push(".localized()");
				break;
			case "virtual":
				if (val === "true") chains.push(".virtual()");
				else chains.push(`.virtual(${val})`);
				break;
			case "input":
				if (val === '"optional"' || val === "'optional'")
					chains.push(".inputOptional()");
				else if (val === "false") chains.push(".inputFalse()");
				break;
			case "output":
				if (val === "false") chains.push(".outputFalse()");
				break;
			case "min":
				chains.push(`.min(${val})`);
				break;
			case "max":
				chains.push(`.max(${val})`);
				break;
			case "access":
				chains.push(`.access(${val})`);
				break;
			case "hooks":
				chains.push(`.hooks(${val})`);
				break;
			case "onDelete":
				chains.push(`.onDelete(${val})`);
				break;
			case "relationName":
				chains.push(`.relationName(${val})`);
				break;
			case "multiple":
				if (val === "true") chains.push(".multiple()");
				break;
			case "unique":
				if (val === "true") chains.push(".unique()");
				break;
			case "meta":
				if (val.includes("admin:")) {
					const braces = val.trim();
					if (braces.startsWith("{")) {
						const innerPairs = parseObjectLiteral(braces.slice(1, -1));
						if (innerPairs) {
							const adminPair = innerPairs.find((p) => p.key === "admin");
							if (adminPair) chains.push(`.admin(${adminPair.rawValue})`);
						}
					}
				}
				break;
			default:
				// Unknown, keep as chain
				chains.push(`.${key}(${val})`);
				break;
		}
	}

	return `f.${fieldType}(${baseArg})${chains.join("")}`;
}

// ============================================================================
// Transform field call
// ============================================================================

function transformFieldCall(fullMatch, fieldType, configStr) {
	const inner = configStr.trim();
	if (!inner || inner === "{}") return `f.${fieldType}()`;

	const pairs = parseObjectLiteral(inner);
	if (!pairs) return fullMatch;

	// Special: object field — unwrap fields: { ... } or fields: () => ({...})
	if (fieldType === "object") {
		return transformObject(pairs, fullMatch);
	}

	// Special: array field — unwrap of: f.xxx(...)
	if (fieldType === "array") {
		return transformArray(pairs, fullMatch);
	}

	return buildChain(fieldType, pairs);
}

function transformObject(pairs, fullMatch) {
	const pairMap = new Map(pairs.map((p) => [p.key, p.rawValue]));

	if (!pairMap.has("fields")) return fullMatch;

	let fieldsContent = pairMap.get("fields");
	pairMap.delete("fields");

	// Unwrap () => ({...}) pattern
	let arrowMatch = fieldsContent.match(/^\(\)\s*=>\s*\(\{([\s\S]*)\}\)$/);
	if (arrowMatch) {
		fieldsContent = arrowMatch[1].trim();
	} else {
		// Unwrap () => ({ ... }) with different whitespace
		arrowMatch = fieldsContent.match(/^\(\)\s*=>\s*\([\s\S]*\)$/);
		if (arrowMatch) {
			// Extract content between outer parens
			const parenContent = fieldsContent
				.replace(/^\(\)\s*=>\s*\(/, "")
				.replace(/\)$/, "")
				.trim();
			if (parenContent.startsWith("{") && parenContent.endsWith("}")) {
				fieldsContent = parenContent.slice(1, -1).trim();
			} else {
				fieldsContent = parenContent;
			}
		} else if (fieldsContent.startsWith("{") && fieldsContent.endsWith("}")) {
			// Plain object: fields: { ... }
			fieldsContent = fieldsContent.slice(1, -1).trim();
		}
	}

	// Build chains from remaining props
	const chains = [];
	for (const [key, val] of pairMap) {
		switch (key) {
			case "required":
				if (val === "true") chains.push(".required()");
				break;
			case "label":
				chains.push(`.label(${val})`);
				break;
			case "localized":
				if (val === "true") chains.push(".localized()");
				break;
			case "default":
				chains.push(`.default(${val})`);
				break;
			case "description":
				chains.push(`.description(${val})`);
				break;
		}
	}

	// Remove trailing comma
	fieldsContent = fieldsContent.replace(/,\s*$/, "");

	return `f.object({\n${fieldsContent},\n})${chains.join("")}`;
}

function transformArray(pairs, fullMatch) {
	const pairMap = new Map(pairs.map((p) => [p.key, p.rawValue]));

	if (!pairMap.has("of")) return fullMatch;

	let innerField = pairMap.get("of");
	pairMap.delete("of");

	const chains = [];
	for (const [key, val] of pairMap) {
		switch (key) {
			case "required":
				if (val === "true") chains.push(".required()");
				break;
			case "label":
				chains.push(`.label(${val})`);
				break;
			case "localized":
				if (val === "true") chains.push(".localized()");
				break;
			case "default":
				chains.push(`.default(${val})`);
				break;
		}
	}

	return `${innerField}.array()${chains.join("")}`;
}

// ============================================================================
// Process a file
// ============================================================================

function processFile(filepath) {
	let content = readFileSync(filepath, "utf-8");

	const fieldTypes = [
		"object",
		"array", // Process these first (they may contain inner V1 calls)
		"text",
		"textarea",
		"number",
		"boolean",
		"datetime",
		"date",
		"time",
		"json",
		"richText",
		"select",
		"email",
		"url",
		"slug",
		"relation",
		"upload",
	];

	let changed = true;
	let iterations = 0;

	while (changed && iterations < 30) {
		changed = false;
		iterations++;

		for (const fieldType of fieldTypes) {
			const pattern = `f.${fieldType}({`;
			let searchStart = 0;

			while (true) {
				const idx = content.indexOf(pattern, searchStart);
				if (idx === -1) break;

				// Check preceding char
				if (idx > 0 && /[a-zA-Z0-9_$]/.test(content[idx - 1])) {
					searchStart = idx + pattern.length;
					continue;
				}

				const braceStart = idx + `f.${fieldType}(`.length;
				const braceEnd = findMatchingBrace(content, braceStart);
				if (braceEnd === -1) {
					searchStart = idx + pattern.length;
					continue;
				}

				// Find closing paren
				let afterBrace = braceEnd;
				while (afterBrace < content.length && /\s/.test(content[afterBrace]))
					afterBrace++;
				if (content[afterBrace] !== ")") {
					searchStart = idx + pattern.length;
					continue;
				}

				const fullEnd = afterBrace + 1;
				const fullMatch = content.slice(idx, fullEnd);
				const configStr = content.slice(braceStart + 1, braceEnd - 1);

				const transformed = transformFieldCall(fullMatch, fieldType, configStr);

				if (transformed !== fullMatch) {
					content =
						content.slice(0, idx) + transformed + content.slice(fullEnd);
					changed = true;
					searchStart = idx + transformed.length;
				} else {
					searchStart = idx + pattern.length;
				}
			}
		}
	}

	return content;
}

// ============================================================================
// Main
// ============================================================================

for (const file of files) {
	if (!existsSync(file)) {
		console.log(`SKIP (not found): ${file}`);
		continue;
	}

	const original = readFileSync(file, "utf-8");
	const transformed = processFile(file);

	if (original !== transformed) {
		writeFileSync(file, transformed);
		console.log(`TRANSFORMED: ${file}`);
	} else {
		console.log(`NO CHANGES: ${file}`);
	}
}
