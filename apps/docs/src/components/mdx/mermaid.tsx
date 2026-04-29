"use client";

import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import { useTheme } from "next-themes";
import { useEffect, useId, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type MermaidRenderState =
	| { status: "idle" | "loading" }
	| {
			status: "ready";
			svg: string;
			bindFunctions?: (element: Element) => void;
	  }
	| { status: "error"; message: string };

function normalizeChart(chart: string): string {
	return chart.replaceAll("\\n", "\n").trim();
}

function getThemeVariables(theme: "dark" | "default") {
	if (theme === "dark") {
		return {
			background: "#1b1b1b",
			fontFamily: "Geist Variable, Inter, sans-serif",
			lineColor: "#737373",
			mainBkg: "#1b1b1b",
			nodeBorder: "#343434",
			primaryBorderColor: "#343434",
			primaryColor: "#1b1b1b",
			primaryTextColor: "#ececec",
			secondaryColor: "#222222",
			tertiaryColor: "#161616",
		};
	}

	return {
		background: "#ffffff",
		fontFamily: "Geist Variable, Inter, sans-serif",
		lineColor: "#858585",
		mainBkg: "#ffffff",
		nodeBorder: "#e2e2e2",
		primaryBorderColor: "#e2e2e2",
		primaryColor: "#ffffff",
		primaryTextColor: "#1c1c1c",
		secondaryColor: "#f0f0f0",
		tertiaryColor: "#fafafa",
	};
}

export function Mermaid({
	chart,
	title = "Mermaid",
}: {
	chart: string;
	title?: string;
}) {
	const id = useId();
	const containerRef = useRef<HTMLDivElement>(null);
	const normalizedChart = useMemo(() => normalizeChart(chart), [chart]);
	const diagramId = useMemo(
		() => `mermaid-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`,
		[id],
	);
	const { resolvedTheme } = useTheme();
	const [mounted, setMounted] = useState(false);
	const [renderState, setRenderState] = useState<MermaidRenderState>({
		status: "idle",
	});

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		if (!mounted) return;

		let cancelled = false;
		const theme = resolvedTheme === "dark" ? "dark" : "default";

		async function renderDiagram() {
			setRenderState({ status: "loading" });

			try {
				const { default: mermaid } = await import("mermaid");

				mermaid.initialize({
					startOnLoad: false,
					securityLevel: "strict",
					fontFamily: "Geist Variable, Inter, sans-serif",
					theme,
					themeCSS: "font-family: var(--font-sans);",
					themeVariables: getThemeVariables(theme),
				});

				const result = await mermaid.render(diagramId, normalizedChart);
				if (!cancelled) {
					setRenderState({
						status: "ready",
						svg: result.svg,
						bindFunctions: result.bindFunctions,
					});
				}
			} catch (error) {
				if (!cancelled) {
					setRenderState({
						status: "error",
						message:
							error instanceof Error ? error.message : "Mermaid render failed.",
					});
				}
			}
		}

		void renderDiagram();

		return () => {
			cancelled = true;
		};
	}, [diagramId, mounted, normalizedChart, resolvedTheme]);

	useEffect(() => {
		if (renderState.status !== "ready" || !containerRef.current) return;
		renderState.bindFunctions?.(containerRef.current);
	}, [renderState]);

	if (renderState.status === "error") {
		return (
			<CodeBlock
				title={`${title} render failed`}
				viewportProps={{ className: "pt-0" }}
			>
				<div className="border-border-subtle text-destructive border-b px-4 py-3 text-sm">
					{renderState.message}
				</div>
				<Pre>
					<code className="language-mermaid">{normalizedChart}</code>
				</Pre>
			</CodeBlock>
		);
	}

	return (
		<CodeBlock
			allowCopy={false}
			className="qp-mermaid-block"
			title={title}
			viewportProps={{ className: "p-4" }}
		>
			<div
				ref={containerRef}
				aria-label={title}
				className={cn(
					"min-h-28 overflow-x-auto",
					"[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full",
					renderState.status === "ready" ? "" : "grid place-items-center",
				)}
				role="img"
			>
				{renderState.status === "ready" ? (
					<div dangerouslySetInnerHTML={{ __html: renderState.svg }} />
				) : (
					<span className="text-muted-foreground text-sm">
						Rendering diagram...
					</span>
				)}
			</div>
		</CodeBlock>
	);
}
