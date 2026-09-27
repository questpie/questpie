import type { CRUDContext } from "#questpie/server/collection/crud/types.js";

/** Projection fields must be readable to every row reader. Conditional field access fails closed. */
export type PassageSource = {
	collection: string;
	tokenFields: string[];
	projectionFields: string[];
	where?: Record<string, unknown>;
};
export type PassageProfile = { id: string; dimensions: number };
export type PassageContext = CRUDContext & { request?: Request };
export type PassageBlock = {
	field: "title" | "content";
	text: string;
	locator: Record<string, string | number>;
	embedding?: number[];
};
export type ReplaceSearchDocument = {
	collection: string;
	recordId: string;
	partition: string;
	representation: string;
	expectedSourceToken: string;
	title: string;
	metadata: Record<string, string>;
	blocks: PassageBlock[];
	retryAt?: Date;
};
export type PassageQuery = {
	partition: string;
	query: string;
	collections?: string[];
	where?: Record<string, Record<string, unknown>>;
	metadata?: Record<string, string>;
	fields?: "title" | "content" | "both";
	vector?: number[];
	mode?: "lexical" | "semantic" | "hybrid";
	limit?: number;
	maxPassagesPerDocument?: number;
};
export type PassageHit = {
	id: string;
	documentId: string;
	collection: string;
	recordId: string;
	representation: string;
	sourceToken: string;
	manifestHash: string;
	title: string;
	field: "title" | "content";
	text: string;
	locator: Record<string, string | number>;
	ordinal: number;
	score: number;
};
