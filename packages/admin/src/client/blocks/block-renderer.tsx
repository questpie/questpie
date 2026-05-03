/**
 * BlockRenderer Component
 *
 * Renders a tree of blocks using registered block definitions.
 * Each block type has a renderer component that receives the block's values.
 *
 * @example
 * ```tsx
 * import { BlockRenderer } from "@questpie/admin/client";
 * import { blocks } from "@/admin/blocks";
 *
 * function PageContent({ page }) {
 *   return (
 *     <BlockRenderer
 *       content={page.content}
 *       blocks={blocks}
 *     />
 *   );
 * }
 * ```
 */

import * as React from "react";

import { cn } from "../lib/utils.js";
import { BlockScopeProvider } from "../preview/block-scope-context.js";
import type { BlockContent, BlockNode } from "./types";

// Module-level constant for empty object to avoid recreating on each render
const EMPTY_DATA: Record<string, unknown> = {};

/**
 * Block renderer function type.
 * Consumers provide their own renderers mapped by block type.
 */
type BlockRendererFn = (props: any) => React.ReactNode;

export type BlockInsertRequest = {
	position: {
		parentId: string | null;
		index: number;
	};
	referenceBlockId?: string;
};

/**
 * Props for BlockRenderer component.
 */
export type BlockRendererProps = {
	/** Block content from API (tree + values) */
	content: BlockContent;
	/** Block renderers mapped by type */
	renderers: Record<string, BlockRendererFn>;
	/** Prefetched data by block ID (optional, for SSR) */
	data?: Record<string, unknown>;
	/** Currently selected block ID (for editor mode) */
	selectedBlockId?: string | null;
	/** Block click handler (for editor mode) */
	onBlockClick?: (blockId: string) => void;
	/** Block insert handler (for preview editor mode) */
	onBlockInsert?: (request: BlockInsertRequest) => void;
	/** Custom class name for the container */
	className?: string;
};

/**
 * Renders a tree of blocks.
 *
 * Iterates through the block tree and renders each block using its
 * registered renderer component. Layout blocks receive their rendered
 * children as the `children` prop.
 */
export function BlockRenderer({
	content,
	renderers,
	data,
	selectedBlockId,
	onBlockClick,
	onBlockInsert,
	className,
}: BlockRendererProps) {
	const resolvedData = data ?? EMPTY_DATA;
	/**
	 * Recursively render a block node.
	 */
	function renderBlock(
		node: BlockNode,
		parentId: string | null,
		index: number,
	): React.ReactNode {
		const renderFn =
			renderers[node.type] ?? renderers[kebabToCamelCase(node.type)];

		if (!renderFn) {
			if (process.env.NODE_ENV !== "production") {
				console.warn(
					`[BlockRenderer] No renderer found for block type "${node.type}"`,
				);
			}
			return null;
		}

		const values = content._values[node.id] || {};
		const blockData = resolvedData[node.id] as
			| Record<string, unknown>
			| undefined;
		const isSelected = selectedBlockId === node.id;

		// Render children for layout blocks
		const renderedChildren =
			node.children.length > 0
				? node.children.map((child, childIndex) =>
						renderBlock(child, node.id, childIndex),
					)
				: undefined;

		const BlockComponent = renderFn;
		const blockElement = (
			<BlockComponent
				id={node.id}
				type={node.type}
				values={values}
				data={blockData}
			>
				{renderedChildren}
			</BlockComponent>
		);
		const scopedBlockElement = (
			<BlockScopeProvider blockId={node.id} basePath="content._values">
				{blockElement}
			</BlockScopeProvider>
		);

		// Wrap in interactive container when in editor mode
		if (onBlockClick) {
			return (
				<React.Fragment key={node.id}>
					<PreviewBlockWrapper
						id={node.id}
						isSelected={isSelected}
						onBlockClick={onBlockClick}
						type={node.type}
					>
						{scopedBlockElement}
					</PreviewBlockWrapper>
					{onBlockInsert && (
						<PreviewBlockInsertControl
							onBlockInsert={onBlockInsert}
							parentId={parentId}
							referenceBlockId={node.id}
							insertIndex={index + 1}
						/>
					)}
				</React.Fragment>
			);
		}

		return (
			<div key={node.id} data-block-id={node.id} data-block-type={node.type}>
				{scopedBlockElement}
			</div>
		);
	}

	if (!content?._tree?.length) {
		return null;
	}

	return (
		<div className={className}>
			{content._tree.map((node, index) => renderBlock(node, null, index))}
		</div>
	);
}

function PreviewBlockInsertControl({
	insertIndex,
	onBlockInsert,
	parentId,
	referenceBlockId,
}: {
	insertIndex: number;
	onBlockInsert: (request: BlockInsertRequest) => void;
	parentId: string | null;
	referenceBlockId: string;
}) {
	const [isHovered, setIsHovered] = React.useState(false);
	const previewRingColor = "var(--ring, var(--highlight, #b700ff))";

	const handleInsert = React.useCallback(
		(event: React.MouseEvent | React.KeyboardEvent) => {
			event.preventDefault();
			event.stopPropagation();
			onBlockInsert({
				position: {
					parentId,
					index: insertIndex,
				},
				referenceBlockId,
			});
		},
		[insertIndex, onBlockInsert, parentId, referenceBlockId],
	);

	return (
		<div
			data-preview-block-insert=""
			style={{
				alignItems: "center",
				display: "flex",
				height: 18,
				justifyContent: "center",
				marginBlock: -9,
				pointerEvents: "none",
				position: "relative",
				zIndex: 40,
			}}
		>
			<button
				type="button"
				aria-label="Add block here"
				onClick={handleInsert}
				onFocus={() => setIsHovered(true)}
				onBlur={() => setIsHovered(false)}
				onMouseEnter={() => setIsHovered(true)}
				onMouseLeave={() => setIsHovered(false)}
				onKeyDown={(event) => {
					if (event.key === "Enter" || event.key === " ") {
						handleInsert(event);
					}
				}}
				style={{
					alignItems: "center",
					background: "var(--background, #fff)",
					border: `1px solid ${previewRingColor}`,
					borderRadius: 999,
					boxShadow: isHovered
						? `0 0 0 4px color-mix(in srgb, ${previewRingColor} 16%, transparent)`
						: "0 4px 14px rgba(0, 0, 0, 0.18)",
					color: previewRingColor,
					cursor: "pointer",
					display: "inline-flex",
					fontSize: 15,
					height: 28,
					justifyContent: "center",
					lineHeight: 1,
					opacity: isHovered ? 1 : 0.62,
					pointerEvents: "auto",
					transition:
						"opacity 150ms ease, box-shadow 150ms ease, transform 150ms ease",
					transform: isHovered ? "scale(1.05)" : "scale(1)",
					width: 28,
				}}
			>
				+
			</button>
		</div>
	);
}

function PreviewBlockWrapper({
	children,
	id,
	isSelected,
	onBlockClick,
	type,
}: {
	children: React.ReactNode;
	id: string;
	isSelected: boolean;
	onBlockClick: (blockId: string) => void;
	type: string;
}) {
	const [isHovered, setIsHovered] = React.useState(false);
	const [hasDomFocus, setHasDomFocus] = React.useState(false);
	const shouldShowAffordance = isHovered || hasDomFocus || isSelected;
	const previewRingColor = "var(--ring, var(--highlight, #b700ff))";

	const previewStyle = React.useMemo<React.CSSProperties>(
		() => ({
			outlineColor: shouldShowAffordance ? previewRingColor : "transparent",
			outlineOffset: "4px",
			outlineStyle: isSelected ? "solid" : "dashed",
			outlineWidth: "2px",
			boxShadow: isSelected
				? `0 0 0 4px color-mix(in srgb, ${previewRingColor} 18%, transparent)`
				: undefined,
			cursor: "pointer",
			transition: "outline-color 150ms ease, box-shadow 150ms ease",
		}),
		[isSelected, shouldShowAffordance],
	);

	const handleClick = React.useCallback(
		(e: React.MouseEvent) => {
			const target = e.target as HTMLElement | null;
			if (target?.closest("[data-preview-field]")) {
				return;
			}

			const closestBlock = target?.closest("[data-block-id]");
			if (closestBlock && closestBlock !== e.currentTarget) {
				return;
			}

			e.preventDefault();
			e.stopPropagation();
			onBlockClick(id);
		},
		[id, onBlockClick],
	);

	const handleKeyDown = React.useCallback(
		(e: React.KeyboardEvent) => {
			const target = e.target as HTMLElement | null;
			if (
				target?.closest("[data-preview-field]") ||
				target?.closest("[data-block-id]") !== e.currentTarget
			) {
				return;
			}
			if (e.key === "Enter" || e.key === " ") {
				e.preventDefault();
				e.stopPropagation();
				onBlockClick(id);
			}
		},
		[id, onBlockClick],
	);

	return (
		<div
			data-block-id={id}
			data-block-type={type}
			data-preview-block=""
			data-preview-block-selected={isSelected ? "true" : undefined}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			onFocus={() => setHasDomFocus(true)}
			onBlur={() => setHasDomFocus(false)}
			role="button"
			tabIndex={0}
			style={previewStyle}
			className={cn(
				"group/preview-block relative cursor-pointer transition-[outline-color,outline-offset,box-shadow] duration-150",
				"hover:outline-primary/40 hover:outline hover:outline-2 hover:outline-offset-4 hover:outline-dashed",
				isSelected &&
					"outline-primary shadow-primary/20 shadow-[0_0_0_4px] outline outline-2 outline-offset-4",
			)}
		>
			{children}
		</div>
	);
}

function kebabToCamelCase(value: string): string {
	return value.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}
