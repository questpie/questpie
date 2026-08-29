import { readFile } from "node:fs/promises";
import { relative, sep } from "node:path";

import ts from "typescript";

import type { LifecycleSource, SourceSpan } from "./types";

export interface ExportSourceMetadata {
	readonly span: SourceSpan;
	readonly memberSpans: Readonly<Record<string, SourceSpan>>;
	readonly acceptanceSpans: readonly (SourceSpan | null)[];
	readonly lifecycleSources: Readonly<Record<string, LifecycleSource>>;
	readonly lifecycleIssueSpans: Readonly<Record<string, SourceSpan>>;
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

function recordLifecycleIssueSpans(
	source: ts.SourceFile,
	phase: string,
	callback: ts.Expression,
	spans: Record<string, SourceSpan>,
): void {
	if (
		phase !== "validate" ||
		(!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback))
	)
		return;
	const parameter = callback.parameters[0]?.name;
	if (!parameter || !ts.isObjectBindingPattern(parameter)) return;
	const issueBinding = parameter.elements.find((element) => {
		const publicName = element.propertyName
			? propertyName(element.propertyName)
			: ts.isIdentifier(element.name)
				? element.name.text
				: null;
		return publicName === "issues" && ts.isIdentifier(element.name);
	});
	if (!issueBinding || !ts.isIdentifier(issueBinding.name)) return;
	const localName = issueBinding.name.text;
	const visit = (node: ts.Node): void => {
		if (ts.isThrowStatement(node)) {
			const call = node.expression;
			if (
				ts.isCallExpression(call) &&
				call.arguments.length === 0 &&
				ts.isPropertyAccessExpression(call.expression) &&
				ts.isIdentifier(call.expression.expression) &&
				call.expression.expression.text === localName
			) {
				const key = `${phase}/${call.expression.name.text}`;
				spans[key] ??= sourceSpan(source, node);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(callback.body);
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
				const lifecycleIssueSpans: Record<string, SourceSpan> = {};
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
									if (phase)
										recordLifecycleIssueSpans(
											source,
											phase,
											member.initializer,
											lifecycleIssueSpans,
										);
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
						lifecycleIssueSpans,
					},
				);
			}
		}
	}
	return metadata;
}
