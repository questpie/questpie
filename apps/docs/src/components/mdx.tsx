import { TypeTable } from "fumadocs-ui/components/type-table";
import defaultComponents from "fumadocs-ui/mdx";
import {
	isValidElement,
	useEffect,
	useId,
	useMemo,
	useState,
	type ComponentProps,
	type ReactElement,
	type ReactNode,
} from "react";

import { cn } from "@/lib/utils";

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

function MermaidDiagram({ code, title }: { code: string; title?: string }) {
	const reactId = useId();
	const diagramId = useMemo(
		() => `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
		[reactId],
	);
	const [svg, setSvg] = useState<string | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		async function renderDiagram() {
			try {
				const { default: mermaid } = await import("mermaid");
				mermaid.initialize({
					startOnLoad: false,
					securityLevel: "strict",
					theme: "dark",
				});

				const result = await mermaid.render(diagramId, code);
				if (!cancelled) {
					setSvg(result.svg);
					setError(null);
				}
			} catch (err) {
				if (!cancelled) {
					setSvg(null);
					setError(err instanceof Error ? err.message : String(err));
				}
			}
		}

		void renderDiagram();

		return () => {
			cancelled = true;
		};
	}, [code, diagramId]);

	return (
		<figure className="group border-border-subtle bg-card relative my-6 overflow-hidden rounded-[var(--surface-radius)] border shadow-[var(--surface-shadow)]">
			{title && (
				<figcaption className="border-border-subtle bg-surface-low border-b px-4 py-2">
					<span className="text-muted-foreground font-chrome text-xs font-medium">
						{title}
					</span>
				</figcaption>
			)}
			<div className="overflow-x-auto p-4">
				{svg ? (
					<div
						className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
						dangerouslySetInnerHTML={{ __html: svg }}
					/>
				) : error ? (
					<pre className="text-destructive overflow-x-auto text-sm whitespace-pre-wrap">
						{error}
					</pre>
				) : (
					<div className="text-muted-foreground text-sm">
						Rendering diagram...
					</div>
				)}
			</div>
		</figure>
	);
}

export function CustomPre({
	title,
	className,
	...props
}: ComponentProps<"pre"> & { title?: string }) {
	const codeChild = getCodeChild(props.children);
	const codeClassName = codeChild?.props.className ?? "";
	const code = getCodeText(codeChild?.props.children ?? props.children).trim();
	if (
		codeClassName.split(/\s+/).includes("language-mermaid") ||
		isMermaidCode(code)
	) {
		return <MermaidDiagram code={code} title={title} />;
	}

	return (
		<div className="group border-border-subtle bg-card relative my-6 overflow-hidden rounded-[var(--surface-radius)] border shadow-[var(--surface-shadow)]">
			{title && (
				<div className="border-border-subtle bg-surface-low border-b px-4 py-2">
					<span className="text-muted-foreground font-chrome text-xs font-medium">
						{title}
					</span>
				</div>
			)}
			{/* We disable the default title rendering by passing undefined, but we keep other functionality */}
			<defaultComponents.pre
				{...props}
				title={undefined}
				className={cn("!my-0 !border-0 !bg-transparent", className)}
			>
				{props.children}
			</defaultComponents.pre>
		</div>
	);
}

export const components = {
	...defaultComponents,
	pre: CustomPre,
	// TypeTable is required for auto-type-table remark plugin
	TypeTable,
};
