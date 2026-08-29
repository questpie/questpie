import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";

import ts from "typescript";

import type { LifecycleSource, SourceSpan } from "./types";

export interface ExportSourceMetadata {
	readonly span: SourceSpan;
	readonly memberSpans: Readonly<Record<string, SourceSpan>>;
	readonly acceptanceSpans: readonly (SourceSpan | null)[];
	readonly lifecycleSources: Readonly<Record<string, LifecycleSource>>;
	readonly mutationCalls: readonly Readonly<{
		collection: string;
		member: "create" | "update";
		span: SourceSpan;
	}>[];
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

function mutationCallsInHandler(
	source: ts.SourceFile,
	node: ts.Expression,
): ExportSourceMetadata["mutationCalls"] {
	if (!ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return [];
	const parameter = node.parameters[0]?.name;
	if (!parameter || !ts.isObjectBindingPattern(parameter)) return [];
	const ctx = parameter.elements.find(
		(element) =>
			propertyName(element.propertyName) === "ctx" ||
			(!element.propertyName &&
				ts.isIdentifier(element.name) &&
				element.name.text === "ctx"),
	);
	if (!ctx || !ts.isIdentifier(ctx.name)) return [];
	const ctxName = ctx.name.text;
	const calls: Array<{
		collection: string;
		member: "create" | "update";
		span: SourceSpan;
	}> = [];
	const visit = (candidate: ts.Node) => {
		if (
			ts.isCallExpression(candidate) &&
			ts.isPropertyAccessExpression(candidate.expression)
		) {
			const member = candidate.expression.name.text;
			const collection = candidate.expression.expression;
			if (
				(member === "create" || member === "update") &&
				ts.isPropertyAccessExpression(collection) &&
				ts.isPropertyAccessExpression(collection.expression) &&
				collection.expression.name.text === "data" &&
				ts.isIdentifier(collection.expression.expression) &&
				collection.expression.expression.text === ctxName
			)
				calls.push({
					collection: collection.name.text,
					member,
					span: sourceSpan(source, candidate.expression),
				});
		}
		ts.forEachChild(candidate, visit);
	};
	visit(node.body);
	return calls;
}

function recordIssueMappingSpans(
	source: ts.SourceFile,
	value: ts.ObjectLiteralExpression,
	memberSpans: Record<string, SourceSpan>,
): void {
	for (const collection of value.properties) {
		if (!ts.isPropertyAssignment(collection)) continue;
		const collectionName = propertyName(collection.name);
		if (!collectionName) continue;
		memberSpans[`issueMapping:${collectionName}`] = sourceSpan(
			source,
			collection,
		);
		if (!ts.isObjectLiteralExpression(collection.initializer)) continue;
		for (const issue of collection.initializer.properties) {
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
				const mutationCalls: Array<
					ExportSourceMetadata["mutationCalls"][number]
				> = [];
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
							if (
								section === "issueMappings" &&
								ts.isObjectLiteralExpression(property.initializer)
							)
								recordIssueMappingSpans(
									source,
									property.initializer,
									memberSpans,
								);
							if (section === "handler")
								mutationCalls.push(
									...mutationCallsInHandler(source, property.initializer),
								);
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
						mutationCalls,
					},
				);
			}
		}
	}
	return metadata;
}
