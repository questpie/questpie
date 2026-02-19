import type { ReactNode } from "react";

import { cn } from "#questpie/admin/client/lib/utils";

/**
 * TipTap JSON node types
 */
export type TipTapNode = {
	type: string;
	content?: TipTapNode[];
	text?: string;
	marks?: Array<{ type: string; attrs?: Record<string, any> }>;
	attrs?: Record<string, any>;
};

export type TipTapDoc = {
	type: "doc";
	content?: TipTapNode[];
};

/**
 * Style configuration for rich text elements
 */
export interface RichTextStyles {
	doc?: string;
	paragraph?: string;
	heading1?: string;
	heading2?: string;
	heading3?: string;
	heading4?: string;
	heading5?: string;
	heading6?: string;
	blockquote?: string;
	codeBlock?: string;
	bulletList?: string;
	orderedList?: string;
	listItem?: string;
	link?: string;
	image?: string;
	tableWrapper?: string;
	table?: string;
	tableRow?: string;
	tableCell?: string;
	tableHeader?: string;
	horizontalRule?: string;
	bold?: string;
	italic?: string;
	code?: string;
	strike?: string;
	underline?: string;
}

const defaultStyles: RichTextStyles = {
	doc: "prose prose-sm max-w-none",
	paragraph: "mb-4 last:mb-0",
	heading1: "text-3xl font-bold mb-4",
	heading2: "text-2xl font-bold mb-3",
	heading3: "text-xl font-semibold mb-3",
	heading4: "text-lg font-semibold mb-2",
	heading5: "text-base font-semibold mb-2",
	heading6: "text-sm font-semibold mb-2",
	blockquote: "border-l-4 border-gray-300 pl-4 italic my-4",
	codeBlock: "bg-muted rounded p-4 font-mono text-sm my-4 overflow-x-auto",
	bulletList: "list-disc list-inside mb-4",
	orderedList: "list-decimal list-inside mb-4",
	listItem: "mb-1",
	link: "text-primary hover:text-primary/80 underline",
	image: "my-4 rounded-lg",
	tableWrapper: "my-4 overflow-x-auto",
	table: "w-full border-collapse",
	tableRow: "border-b",
	tableCell: "border border-border px-3 py-2 align-top",
	tableHeader: "border border-border px-3 py-2 text-left font-semibold",
	horizontalRule: "my-4 border-t border-border",
	bold: "font-bold",
	italic: "italic",
	code: "bg-muted rounded px-1 py-0.5 font-mono text-sm",
	strike: "line-through",
	underline: "underline",
};

interface RichTextRendererProps {
	/**
	 * TipTap JSON content to render
	 */
	content: TipTapDoc | null | undefined;
	/**
	 * Custom styles for elements
	 */
	styles?: Partial<RichTextStyles>;
	/**
	 * Additional className for the root element
	 */
	className?: string;
}

/**
 * Renders a single TipTap node
 */
function renderNode(
	node: TipTapNode,
	index: number,
	styles: RichTextStyles,
): ReactNode {
	// Text node
	if (node.text !== undefined) {
		let textNode: ReactNode = node.text;

		// Apply marks (bold, italic, etc.)
		if (node.marks) {
			for (const mark of node.marks) {
				// Generate stable key based on mark type and text content
				const markKey = `${mark.type}-${node.text?.slice(0, 20) ?? ""}-${index}`;
				switch (mark.type) {
					case "bold":
						textNode = (
							<strong key={markKey} className={styles.bold}>
								{textNode}
							</strong>
						);
						break;
					case "italic":
						textNode = (
							<em key={markKey} className={styles.italic}>
								{textNode}
							</em>
						);
						break;
					case "code":
						textNode = (
							<code key={markKey} className={styles.code}>
								{textNode}
							</code>
						);
						break;
					case "strike":
						textNode = (
							<s key={markKey} className={styles.strike}>
								{textNode}
							</s>
						);
						break;
					case "underline":
						textNode = (
							<u key={markKey} className={styles.underline}>
								{textNode}
							</u>
						);
						break;
					case "link": {
						const href = mark.attrs?.href as string | undefined;
						const target = mark.attrs?.target as string | undefined;
						const rel =
							(mark.attrs?.rel as string | undefined) ||
							(target === "_blank" ? "noopener noreferrer" : undefined);
						textNode = (
							<a
								key={markKey}
								href={href}
								target={target}
								rel={rel}
								className={styles.link}
							>
								{textNode}
							</a>
						);
						break;
					}
				}
			}
		}

		return textNode;
	}

	// Generate stable key for block nodes based on type, content, and index
	const nodeKey = `${node.type}-${node.text?.slice(0, 20) ?? ""}-${index}`;

	// Block nodes
	const children = node.content?.map((child, i) =>
		renderNode(child, i, styles),
	);

	switch (node.type) {
		case "doc":
			return <div key={nodeKey}>{children}</div>;

		case "paragraph": {
			const paragraphAlign = node.attrs?.textAlign as
				| "left"
				| "center"
				| "right"
				| "justify"
				| undefined;
			return (
				<p
					key={nodeKey}
					className={styles.paragraph}
					style={paragraphAlign ? { textAlign: paragraphAlign } : undefined}
				>
					{children}
				</p>
			);
		}

		case "heading": {
			const level = Math.min(
				6,
				Math.max(1, (node.attrs?.level as number) || 1),
			);
			const headingAlign = node.attrs?.textAlign as
				| "left"
				| "center"
				| "right"
				| "justify"
				| undefined;
			const headingClass =
				styles[`heading${level}` as keyof RichTextStyles] || styles.heading1;
			type HeadingTagName = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";
			const HeadingTag = `h${level}` as HeadingTagName;
			return (
				<HeadingTag
					key={nodeKey}
					className={headingClass}
					style={headingAlign ? { textAlign: headingAlign } : undefined}
				>
					{children}
				</HeadingTag>
			);
		}

		case "blockquote":
			return (
				<blockquote key={nodeKey} className={styles.blockquote}>
					{children}
				</blockquote>
			);

		case "codeBlock":
			return (
				<pre key={nodeKey} className={styles.codeBlock}>
					<code>{children}</code>
				</pre>
			);

		case "bulletList":
			return (
				<ul key={nodeKey} className={styles.bulletList}>
					{children}
				</ul>
			);

		case "orderedList":
			return (
				<ol key={nodeKey} className={styles.orderedList}>
					{children}
				</ol>
			);

		case "listItem":
			return (
				<li key={nodeKey} className={styles.listItem}>
					{children}
				</li>
			);

		case "hardBreak":
			return <br key={nodeKey} />;

		case "horizontalRule":
			return <hr key={nodeKey} className={styles.horizontalRule} />;

		case "image": {
			const src = node.attrs?.src as string | undefined;
			if (!src) return null;
			return (
				<img
					key={index}
					src={src}
					alt={(node.attrs?.alt as string | undefined) || ""}
					title={node.attrs?.title as string | undefined}
					className={styles.image}
					loading="lazy"
				/>
			);
		}

		case "table":
			return (
				<div key={index} className={styles.tableWrapper}>
					<table className={styles.table}>
						<tbody>{children}</tbody>
					</table>
				</div>
			);

		case "tableRow":
			return (
				<tr key={index} className={styles.tableRow}>
					{children}
				</tr>
			);

		case "tableCell":
			return (
				<td
					key={index}
					className={styles.tableCell}
					colSpan={node.attrs?.colspan as number | undefined}
					rowSpan={node.attrs?.rowspan as number | undefined}
				>
					{children}
				</td>
			);

		case "tableHeader":
			return (
				<th
					key={index}
					className={styles.tableHeader}
					colSpan={node.attrs?.colspan as number | undefined}
					rowSpan={node.attrs?.rowspan as number | undefined}
				>
					{children}
				</th>
			);

		default:
			// Unknown node type - render children if available
			return children ? <div key={index}>{children}</div> : null;
	}
}

/**
 * RichTextRenderer Component
 *
 * Renders TipTap JSON content with customizable styles.
 *
 * @example
 * ```tsx
 * const content = {
 *   type: "doc",
 *   content: [
 *     {
 *       type: "paragraph",
 *       content: [{ type: "text", text: "Hello world" }]
 *     }
 *   ]
 * };
 *
 * <RichTextRenderer content={content} />
 * ```
 *
 * @example With custom styles
 * ```tsx
 * <RichTextRenderer
 *   content={content}
 *   styles={{
 *     paragraph: "text-lg leading-relaxed",
 *     heading1: "text-4xl font-black"
 *   }}
 * />
 * ```
 */
export function RichTextRenderer({
	content,
	styles: customStyles,
	className,
}: RichTextRendererProps) {
	if (!content || !content.content || content.content.length === 0) {
		return null;
	}

	const styles = { ...defaultStyles, ...customStyles };

	return (
		<div className={cn(styles.doc, className)}>
			{content.content.map((node, i) => renderNode(node, i, styles))}
		</div>
	);
}
