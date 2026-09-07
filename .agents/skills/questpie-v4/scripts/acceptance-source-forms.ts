import ts from "typescript";

import { parseAcceptanceDiffLines } from "./acceptance-diff-lines";

export type AcceptanceSourceReader = (
	path: string,
	side: "base" | "head",
) => string;
type Source = {
	lines: string[];
	starts: number[];
	keys: Array<{ start: number; end: number }>;
};

function passwordReference(node: ts.Expression): boolean {
	if (!ts.isPropertyAccessExpression(node) || node.name.text !== "password")
		return false;
	let current: ts.Expression = node;
	while (ts.isPropertyAccessExpression(current)) {
		if (current.questionDotToken || !ts.isIdentifier(current.name))
			return false;
		current = current.expression;
	}
	return ts.isIdentifier(current);
}

function sourceForms(path: string, source: string): Source {
	const lines = source.split("\n");
	const starts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		starts.push(offset);
		offset += line.length + 1;
	}
	const keys: Source["keys"] = [];
	const result = ts.transpileModule(source, {
		fileName: path,
		compilerOptions: {
			target: ts.ScriptTarget.ESNext,
			jsx: ts.JsxEmit.Preserve,
		},
		reportDiagnostics: true,
		transformers: {
			before: [
				() => (file) => {
					function visit(node: ts.Node): void {
						if (
							ts.isParameter(node) &&
							ts.isIdentifier(node.name) &&
							node.name.text === "password" &&
							node.type?.kind === ts.SyntaxKind.StringKeyword &&
							!node.initializer
						) {
							keys.push({
								start: node.name.getStart(file),
								end: node.name.end,
							});
						}
						if (
							ts.isPropertyAssignment(node) &&
							ts.isObjectLiteralExpression(node.parent) &&
							ts.isIdentifier(node.name) &&
							node.name.text === "password" &&
							passwordReference(node.initializer)
						) {
							keys.push({
								start: node.name.getStart(file),
								end: node.name.end,
							});
						}
						ts.forEachChild(node, visit);
					}
					visit(file);
					return file;
				},
			],
		},
	});
	return { lines, starts, keys: result.diagnostics?.length ? [] : keys };
}

/** Returns a scan-only shadow; committed packet bytes must continue to use the original diff. */
export function maskAcceptanceSourceForms(
	diff: string,
	readSource: AcceptanceSourceReader,
): string {
	const sources = new Map<string, Source>();
	return parseAcceptanceDiffLines(diff)
		.map((line) => {
			if (
				!line.path ||
				!/\.tsx?$/.test(line.path) ||
				!/\bpassword\b/.test(line.text)
			)
				return line.text;
			const sides: Array<"base" | "head"> =
				line.kind === "context"
					? ["base", "head"]
					: [line.kind === "removed" ? "base" : "head"];
			let keys: Source["keys"] | undefined;
			for (const side of sides) {
				const number = side === "base" ? line.oldLine : line.newLine;
				if (number === undefined) return line.text;
				const cacheKey = `${side}:${line.path}`;
				let source = sources.get(cacheKey);
				if (!source) {
					source = sourceForms(line.path, readSource(line.path, side));
					sources.set(cacheKey, source);
				}
				if (source.lines[number - 1] !== line.text.slice(1))
					throw new Error("Acceptance diff source line mismatch");
				const start = source.starts[number - 1]!;
				const ranges = source.keys
					.filter(
						(key) =>
							key.start >= start && key.end <= start + line.text.length - 1,
					)
					.map((key) => ({
						start: key.start - start + 1,
						end: key.end - start + 1,
					}));
				keys =
					keys === undefined
						? ranges
						: keys.filter((key) =>
								ranges.some(
									(other) => key.start === other.start && key.end === other.end,
								),
							);
			}
			const characters = line.text.split("");
			for (const key of keys ?? []) {
				for (let index = key.start; index < key.end; index += 1)
					characters[index] = " ";
			}
			return characters.join("");
		})
		.join("\n");
}
