/**
 * Primitive Cell Components
 *
 * Simple cell renderers for basic data types:
 * - Text, Number, Boolean
 * - Date, DateTime, Time
 * - Email, Select
 * - DefaultCell (ultra-simple fallback)
 */

import * as React from "react";
import { Badge } from "../../../components/ui/badge";

// ============================================================================
// Default Cell (Ultra-Simple Fallback)
// ============================================================================

/**
 * Ultra-simple default cell renderer
 * Used as fallback when field has no .cell defined
 */
export function DefaultCell({ value }: { value: unknown }) {
	if (value === null || value === undefined) {
		return <span className="text-muted-foreground">-</span>;
	}
	return <span>{String(value)}</span>;
}

// ============================================================================
// Text Cells
// ============================================================================

/**
 * Text cell - simple text display with truncation
 */
export function TextCell({ value }: { value: unknown }) {
	if (value === null || value === undefined || value === "") {
		return <span className="text-muted-foreground">-</span>;
	}
	const text = String(value);
	return (
		<span className="truncate max-w-[300px] block" title={text}>
			{text}
		</span>
	);
}

function stripHtmlTags(value: string): string {
	return value
		.replace(/<[^>]*>/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function extractTextFromNode(node: any): string {
	if (!node) return "";
	if (Array.isArray(node)) {
		return node.map(extractTextFromNode).filter(Boolean).join(" ");
	}
	if (typeof node.text === "string") return node.text;
	if (Array.isArray(node.content)) {
		return node.content.map(extractTextFromNode).filter(Boolean).join(" ");
	}
	return "";
}

function getRichTextPreview(value: unknown): string {
	if (value === null || value === undefined) return "";
	if (typeof value === "string") {
		const hasHtml = /<\/?[a-z][\s\S]*>/i.test(value);
		return hasHtml ? stripHtmlTags(value) : value.trim();
	}
	if (typeof value === "object") {
		const text = extractTextFromNode(value);
		return text.replace(/\s+/g, " ").trim();
	}
	return String(value);
}

export function RichTextCell({ value }: { value: unknown }) {
	const text = getRichTextPreview(value);
	if (!text) {
		return <span className="text-muted-foreground">-</span>;
	}
	return (
		<span className="truncate max-w-[300px] block" title={text}>
			{text}
		</span>
	);
}

// ============================================================================
// Number Cell
// ============================================================================

/**
 * Number cell - right-aligned number display
 */
export function NumberCell({ value }: { value: unknown }) {
	if (value === null || value === undefined) {
		return <span className="text-muted-foreground">-</span>;
	}
	const num = Number(value);
	return (
		<span className="tabular-nums">
			{Number.isNaN(num) ? String(value) : num.toLocaleString()}
		</span>
	);
}

// ============================================================================
// Boolean Cell
// ============================================================================

/**
 * Boolean cell - badge display
 */
export function BooleanCell({ value }: { value: unknown }) {
	return (
		<Badge variant={value ? "default" : "secondary"}>
			{value ? "Yes" : "No"}
		</Badge>
	);
}

// ============================================================================
// Date/Time Cells
// ============================================================================

/**
 * Date cell - formatted date display
 */
export function DateCell({ value }: { value: unknown }) {
	if (value === null || value === undefined) {
		return <span className="text-muted-foreground">-</span>;
	}
	const date = value instanceof Date ? value : new Date(String(value));
	if (Number.isNaN(date.getTime())) {
		return <span className="text-muted-foreground">{String(value)}</span>;
	}
	return <span className="tabular-nums">{date.toLocaleDateString()}</span>;
}

/**
 * DateTime cell - formatted date and time display
 */
export function DateTimeCell({ value }: { value: unknown }) {
	if (value === null || value === undefined) {
		return <span className="text-muted-foreground">-</span>;
	}
	const date = value instanceof Date ? value : new Date(String(value));
	if (Number.isNaN(date.getTime())) {
		return <span className="text-muted-foreground">{String(value)}</span>;
	}
	return (
		<span className="tabular-nums">
			{date.toLocaleDateString()} {date.toLocaleTimeString()}
		</span>
	);
}

/**
 * Time cell - formatted time display (for time-only values stored as string)
 */
export function TimeCell({ value }: { value: unknown }) {
	if (value === null || value === undefined || value === "") {
		return <span className="text-muted-foreground">-</span>;
	}
	// Time values are stored as "HH:mm" or "HH:mm:ss" strings
	return <span className="tabular-nums">{String(value)}</span>;
}

// ============================================================================
// Special Text Cells
// ============================================================================

/**
 * Email cell - displays email with mailto link styling
 */
export function EmailCell({ value }: { value: unknown }) {
	if (value === null || value === undefined || value === "") {
		return <span className="text-muted-foreground">-</span>;
	}
	return <span className="text-primary">{String(value)}</span>;
}

/**
 * Select/Status cell - badge display
 */
export function SelectCell({ value }: { value: unknown }) {
	if (value === null || value === undefined || value === "") {
		return <span className="text-muted-foreground">-</span>;
	}
	return <Badge variant="outline">{String(value)}</Badge>;
}
