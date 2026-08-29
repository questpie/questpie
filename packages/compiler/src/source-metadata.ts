import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";

import ts from "typescript";

import type { LifecycleSource, SourceSpan } from "./types";

export interface ExportSourceMetadata {
	readonly span: SourceSpan;
	readonly memberSpans: Readonly<Record<string, SourceSpan>>;
	readonly acceptanceSpans: readonly (SourceSpan | null)[];
	readonly lifecycleSources: Readonly<Record<string, LifecycleSource>>;
}

function logicalPath(root: string, path: string): string {
	return relative(root, path).split(sep).join("/");
}

function sourceSpan(source: ts.SourceFile, node: ts.Node): SourceSpan {
	const start = source.getLineAndCharacterOfPosition(node.getStart(source));
	const end = source.getLineAndCharacterOfPosition(node.getEnd());
	return {
		start: { line: start.line + 1, column: start.character + 1 },
		end: { line: end.line + 1, column: end.character + 1 },
	};
}

function propertyName(node: ts.PropertyName | undefined): string | null {
	if (!node) return null;
	return ts.isIdentifier(node) ||
		ts.isStringLiteral(node) ||
		ts.isNumericLiteral(node)
		? node.text
		: null;
}

function recordIssueMappingSpans(
	source: ts.SourceFile,
	value: ts.ObjectLiteralExpression,
	memberSpans: Record<string, SourceSpan>,
	initializers: ReadonlyMap<string, ts.Expression>,
): void {
	for (const collection of value.properties) {
		if (!ts.isPropertyAssignment(collection)) continue;
		const collectionName = propertyName(collection.name);
		if (!collectionName) continue;
		memberSpans[`issueMapping:${collectionName}`] = sourceSpan(
			source,
			collection,
		);
		const issues = resolveObjectLiteral(collection.initializer, initializers);
		if (!issues) continue;
		for (const issue of issues.properties) {
			if (!ts.isPropertyAssignment(issue)) continue;
			const issueName = propertyName(issue.name);
			if (issueName)
				memberSpans[`issueMapping:${collectionName}/${issueName}`] = sourceSpan(
					source,
					issue,
				);
		}
	}
}

function resolveObjectLiteral(
	value: ts.Expression,
	initializers: ReadonlyMap<string, ts.Expression>,
	seen: ReadonlySet<string> = new Set(),
): ts.ObjectLiteralExpression | null {
	if (ts.isObjectLiteralExpression(value)) return value;
	if (!ts.isIdentifier(value) || seen.has(value.text)) return null;
	const initializer = initializers.get(value.text);
	return initializer
		? resolveObjectLiteral(
				initializer,
				initializers,
				new Set(seen).add(value.text),
			)
		: null;
}

const directSections = new Set(
	"list get create update delete issueMappings".split(" "),
);
const nestedSections = "|fields|issues|constraints|indexes|relations|";

export async function directExportMetadata(
	applicationRoot: string,
	files: readonly string[],
): Promise<Map<string, ExportSourceMetadata>> {
	const metadata = new Map<string, ExportSourceMetadata>();
	for (const path of files) {
		const source = ts.createSourceFile(
			path,
			await readFile(path, "utf8"),
			ts.ScriptTarget.Latest,
			true,
			ts.ScriptKind.TS,
		);
		const initializers = new Map<string, ts.Expression>();
		for (const statement of source.statements)
			if (ts.isVariableStatement(statement))
				for (const declaration of statement.declarationList.declarations)
					if (ts.isIdentifier(declaration.name) && declaration.initializer)
						initializers.set(declaration.name.text, declaration.initializer);
		for (const statement of source.statements) {
			if (
				!ts.isVariableStatement(statement) ||
				!statement.modifiers?.some(
					(modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
				)
			)
				continue;
			for (const declaration of statement.declarationList.declarations) {
				if (!ts.isIdentifier(declaration.name) || !declaration.initializer)
					continue;
				const memberSpans: Record<string, SourceSpan> = {};
				const acceptanceSpans: Array<SourceSpan | null> = [];
				const lifecycleSources: Record<string, LifecycleSource> = {};
				if (ts.isCallExpression(declaration.initializer)) {
					const [first, second] = declaration.initializer.arguments;
					const definition =
						first && ts.isObjectLiteralExpression(first)
							? first
							: second && ts.isObjectLiteralExpression(second)
								? second
								: null;
					if (definition)
						for (const property of definition.properties) {
							if (!ts.isPropertyAssignment(property)) continue;
							const section = propertyName(property.name);
							if (section && directSections.has(section))
								memberSpans[section] = sourceSpan(source, property);
							const nestedKind =
								section && nestedSections.includes(`|${section}|`)
									? section === "indexes"
										? "index"
										: section === "issues"
											? "issue"
											: section.slice(0, -1)
									: undefined;
							if (
								nestedKind &&
								ts.isObjectLiteralExpression(property.initializer)
							)
								for (const member of property.initializer.properties) {
									if (!ts.isPropertyAssignment(member)) continue;
									const name = propertyName(member.name);
									if (name)
										memberSpans[`${nestedKind}:${name}`] = sourceSpan(
											source,
											member,
										);
								}
							if (section === "issueMappings") {
								const mappings = resolveObjectLiteral(
									property.initializer,
									initializers,
								);
								if (mappings)
									recordIssueMappingSpans(
										source,
										mappings,
										memberSpans,
										initializers,
									);
							}
							if (
								section === "lifecycle" &&
								ts.isObjectLiteralExpression(property.initializer)
							)
								for (const member of property.initializer.properties) {
									if (!ts.isPropertyAssignment(member)) continue;
									const phase = propertyName(member.name);
									if (
										phase &&
										["normalize", "validate", "check", "afterWrite"].includes(
											phase,
										)
									)
										lifecycleSources[phase] = {
											source: member.initializer.getText(source),
											span: sourceSpan(source, member.initializer),
										};
								}
							if (
								section === "augmentations" &&
								ts.isArrayLiteralExpression(property.initializer)
							)
								for (const element of property.initializer.elements)
									acceptanceSpans.push(sourceSpan(source, element));
						}
				}
				metadata.set(
					`${logicalPath(applicationRoot, path)}\0${declaration.name.text}`,
					{
						span: sourceSpan(source, declaration.name),
						memberSpans,
						acceptanceSpans,
						lifecycleSources,
					},
				);
			}
		}
	}
	return metadata;
}
