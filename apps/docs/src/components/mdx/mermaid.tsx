"use client";

import { CodeBlock, Pre } from "fumadocs-ui/components/codeblock";
import {
	useEffect,
	useId,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import { cn } from "@/lib/utils";

type MermaidRenderState =
	| { status: "idle" | "loading" }
	| {
			status: "ready";
			svg: string;
			bindFunctions?: (element: Element) => void;
	  }
	| { status: "error"; message: string };

type MermaidTheme = "dark" | "default";
type MermaidModule = typeof import("mermaid").default;

let mermaidPromise: Promise<MermaidModule> | undefined;

function loadMermaid() {
	mermaidPromise ??= import("mermaid").then((module) => module.default);
	return mermaidPromise;
}

function normalizeChart(chart: string): string {
	return chart.replaceAll("\\n", "\n").trim();
}

function resolveMermaidTheme(): MermaidTheme {
	if (typeof document === "undefined") return "dark";
	return document.documentElement.classList.contains("light")
		? "default"
		: "dark";
}

function subscribeTheme(onStoreChange: () => void) {
	const observer = new MutationObserver(onStoreChange);
	observer.observe(document.documentElement, {
		attributeFilter: ["class"],
		attributes: true,
	});

	return () => observer.disconnect();
}

/* Mermaid needs literal colours: it derives contrast and stroke shades from what
 * you give it, so a `var(--card)` string reaches its colour maths as nonsense.
 *
 * The tokens are oklch, and neither `ctx.fillStyle` round-tripping nor
 * getComputedStyle converts that to sRGB — both hand the oklch string straight
 * back. Painting one pixel and reading it does convert, because the canvas has
 * already rasterised to bytes by then. Verified against known values: `white`
 * gives #ffffff, `--coral` gives #f26a45, `--background` gives #12100d, which is
 * exactly what the canon documents in the token comments. */
/* No hardcoded fallback, deliberately. A second copy of the palette here is
 * exactly what drifts, and both readers below are reached only from inside an
 * effect, so there is no server pass to defend against. If a token ever went
 * missing the value comes back empty and mermaid uses its own base theme — the
 * behaviour this file had before tokens existed. */
function readToken(name: string): string {
	return getComputedStyle(document.documentElement)
		.getPropertyValue(name)
		.trim();
}

function readColor(name: string): string {
	const value = readToken(name);
	if (!value) return value;

	const canvas = document.createElement("canvas");
	canvas.width = 1;
	canvas.height = 1;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return value;

	ctx.fillStyle = value;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
	return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

/* One palette, read live, instead of two hardcoded ones. The light and dark
 * branches this replaces were a neutral grey ramp that belonged to no design
 * system in this repo, and their font was Geist, which the brand no longer uses.
 * Reading tokens means a theme flip needs no second table — the caller already
 * re-runs this when the class on <html> changes. */
function getThemeVariables() {
	const ink = readColor("--foreground");
	const surface = readColor("--card");

	return {
		background: surface,
		/* primaryTextColor alone does not reach label text — measured, node labels
		   came out at mermaid's own #cccccc in dark and #333333 in light. textColor
		   and nodeTextColor are the ones that land. */
		edgeLabelBackground: surface,
		fontFamily: readToken("--font-sans"),
		lineColor: readColor("--foreground-subtle"),
		mainBkg: surface,
		nodeBorder: readColor("--border"),
		nodeTextColor: ink,
		primaryBorderColor: readColor("--border"),
		primaryColor: surface,
		primaryTextColor: ink,
		secondaryColor: readColor("--surface-mid"),
		tertiaryColor: readColor("--surface-low"),
		textColor: ink,
		titleColor: ink,
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
	const normalizedChart = normalizeChart(chart);
	const diagramId = `mermaid-${id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
	const theme = useSyncExternalStore(
		subscribeTheme,
		resolveMermaidTheme,
		(): MermaidTheme => "dark",
	);
	const [renderState, setRenderState] = useState<MermaidRenderState>({
		status: "idle",
	});

	useEffect(() => {
		let cancelled = false;

		async function renderDiagram() {
			setRenderState({ status: "loading" });

			try {
				const mermaid = await loadMermaid();

				mermaid.initialize({
					startOnLoad: false,
					securityLevel: "strict",
					fontFamily: readToken("--font-sans"),
					/* still the base theme mermaid derives everything else from —
					   themeVariables only override what this file names */
					theme,
					themeCSS: "font-family: var(--font-sans);",
					themeVariables: getThemeVariables(),
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
	}, [diagramId, normalizedChart, theme]);

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
