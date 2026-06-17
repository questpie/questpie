import { Icon } from "@iconify/react";
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
import { cn } from "@/lib/utils";

type CodeElementProps = {
	className?: string;
	children?: ReactNode;
};

type ElementWithChildrenProps = {
	children?: ReactNode;
};

type DocsCalloutType =
	| "info"
	| "warn"
	| "warning"
	| "error"
	| "danger"
	| "success"
	| "tip"
	| "idea";

type DocsCalloutContainerProps = Omit<ComponentProps<"div">, "title"> & {
	type?: DocsCalloutType;
	icon?: ReactNode;
};

type DocsCalloutProps = DocsCalloutContainerProps & {
	title?: ReactNode;
};

const calloutIcons: Record<string, string> = {
	info: "ph:info",
	warn: "ph:warning",
	warning: "ph:warning",
	error: "ph:x-circle",
	danger: "ph:x-circle",
	success: "ph:check-circle",
	tip: "ph:check-circle",
	idea: "ph:lightbulb",
};

function normalizeCalloutType(type: DocsCalloutType = "info") {
	if (type === "warning") return "warn";
	if (type === "danger") return "error";
	if (type === "tip") return "success";
	return type;
}

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

function DocsCalloutContainer({
	type = "info",
	icon,
	children,
	className,
	...props
}: DocsCalloutContainerProps) {
	const normalizedType = normalizeCalloutType(type);

	return (
		<div
			data-callout={normalizedType}
			className={cn("docs-callout", className)}
			{...props}
		>
			<span className="docs-callout__icon" aria-hidden="true">
				{icon ?? (
					<Icon
						icon={calloutIcons[type] ?? calloutIcons.info}
						className="size-4"
					/>
				)}
			</span>
			<div className="docs-callout__body">{children}</div>
		</div>
	);
}

function DocsCalloutTitle({
	className,
	...props
}: Omit<ComponentProps<"p">, "title">) {
	return <p className={cn("docs-callout__title", className)} {...props} />;
}

function DocsCalloutDescription({
	className,
	...props
}: ComponentProps<"div">) {
	return (
		<div className={cn("docs-callout__description", className)} {...props} />
	);
}

function DocsCallout({ title, children, ...props }: DocsCalloutProps) {
	return (
		<DocsCalloutContainer {...props}>
			{title ? <DocsCalloutTitle>{title}</DocsCalloutTitle> : null}
			<DocsCalloutDescription>{children}</DocsCalloutDescription>
		</DocsCalloutContainer>
	);
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
		Callout: DocsCallout,
		CalloutContainer: DocsCalloutContainer,
		CalloutTitle: DocsCalloutTitle,
		CalloutDescription: DocsCalloutDescription,
		...components,
	} satisfies MDXComponents;
}
