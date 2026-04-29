import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { TypeTable } from "fumadocs-ui/components/type-table";
import defaultMdxComponents from "fumadocs-ui/mdx";
import type { MDXComponents } from "mdx/types";
import {
	isValidElement,
	type ComponentProps,
	type ReactElement,
	type ReactNode,
} from "react";

import { Mermaid } from "@/components/mdx/mermaid";

type CodeElementProps = {
	className?: string;
	children?: ReactNode;
};

type ElementWithChildrenProps = {
	children?: ReactNode;
};

function isCodeElement(
	node: ReactNode,
): node is ReactElement<CodeElementProps, "code"> {
	return isValidElement<CodeElementProps>(node) && node.type === "code";
}

function getCodeText(node: ReactNode): string {
	if (typeof node === "string") return node;
	if (typeof node === "number") return String(node);
	if (Array.isArray(node)) return node.map(getCodeText).join("");
	if (isValidElement<ElementWithChildrenProps>(node)) {
		return getCodeText(node.props.children);
	}
	return "";
}

function isMermaidCode(code: string): boolean {
	return /^(flowchart|graph|sequenceDiagram|classDiagram|stateDiagram|stateDiagram-v2|erDiagram|journey|gantt|pie|mindmap|timeline|gitGraph)\b/.test(
		code.trim(),
	);
}

function getCodeChild(children: ReactNode) {
	if (isCodeElement(children)) return children;
	if (!Array.isArray(children)) return null;
	return children.find(isCodeElement) ?? null;
}

function MarkdownPre({
	ref: _ref,
	children,
	...props
}: ComponentProps<"pre"> & { title?: string }) {
	const codeChild = getCodeChild(children);
	const codeClassName = codeChild?.props.className ?? "";
	const code = getCodeText(codeChild?.props.children ?? children).trim();
	if (
		codeClassName.split(/\s+/).includes("language-mermaid") ||
		isMermaidCode(code)
	) {
		return <Mermaid chart={code} title={props.title ?? "Mermaid"} />;
	}

	return (
		<CodeBlock {...props}>
			<Pre>{children}</Pre>
		</CodeBlock>
	);
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
	return {
		...defaultMdxComponents,
		pre: MarkdownPre,
		Mermaid,
		TypeTable,
		...components,
	} satisfies MDXComponents;
}
