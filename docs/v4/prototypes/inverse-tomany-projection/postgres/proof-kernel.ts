export const inverseListSql = `WITH "qp_roots" AS MATERIALIZED (
  SELECT
    "ticket"."id" AS "root_id",
    "ticket"."title" AS "root_title",
    row_number() OVER (ORDER BY "ticket"."id" ASC) AS "root_ordinal"
  FROM "qp_inverse_tickets" AS "ticket"
  WHERE "ticket"."tenant_id" = $1
    AND "ticket"."authorized" = TRUE
    AND ($2::text IS NULL OR "ticket"."id" > $2)
  ORDER BY "ticket"."id" ASC
  LIMIT ($3 + 1)
)
SELECT
  "root"."root_id",
  "root"."root_title",
  "root"."root_ordinal",
  "child"."child_id",
  "child"."child_body",
  "child"."child_body_allowed",
  "child"."child_created_at",
  "child"."child_ordinal"
FROM "qp_roots" AS "root"
LEFT JOIN LATERAL (
  SELECT
    "comment"."id" AS "child_id",
    CASE WHEN "comment"."body_allowed" THEN "comment"."body" ELSE NULL END AS "child_body",
    "comment"."body_allowed" AS "child_body_allowed",
    "comment"."created_at" AS "child_created_at",
    row_number() OVER (
      ORDER BY "comment"."created_at" DESC, "comment"."id" DESC
    ) AS "child_ordinal"
  FROM "qp_inverse_comments" AS "comment"
  WHERE "comment"."ticket_id" = "root"."root_id"
    AND "comment"."tenant_id" = $1
    AND "comment"."authorized" = TRUE
    AND "comment"."body" <> 'filtered'
  ORDER BY "comment"."created_at" DESC, "comment"."id" DESC
  LIMIT $4
) AS "child" ON TRUE
ORDER BY "root"."root_ordinal" ASC, "child"."child_ordinal" ASC NULLS FIRST;
`;

export type InverseListRow = Readonly<{
	root_id: unknown;
	root_title: unknown;
	root_ordinal: unknown;
	child_id: unknown;
	child_body: unknown;
	child_body_allowed: unknown;
	child_created_at: unknown;
	child_ordinal: unknown;
}>;

export type TicketProjection = Readonly<{
	id: string;
	title: string;
	comments: readonly Readonly<{
		id: string;
		body?: string;
		createdAt: number;
	}>[];
}>;

export function assertChildOrderDisclosure(
	input: Readonly<{
		orderFields: readonly string[];
		selectedFields: readonly string[];
		unconditionallyVisibleFields: readonly string[];
	}>,
): void {
	const selected = new Set(input.selectedFields);
	const visible = new Set(input.unconditionallyVisibleFields);
	if (
		input.orderFields.some(
			(field) => !selected.has(field) || !visible.has(field),
		)
	)
		throw new TypeError("QP-DATA-008 orderFieldNotSelected");
}

function integer(value: unknown, label: string): number {
	const parsed = typeof value === "string" ? Number(value) : value;
	if (typeof parsed !== "number" || !Number.isSafeInteger(parsed))
		throw new TypeError(`invalid ${label}`);
	return parsed;
}

function text(value: unknown, label: string): string {
	if (typeof value !== "string") throw new TypeError(`invalid ${label}`);
	return value;
}

export function decodeInverseList(
	rows: readonly InverseListRow[],
	input: Readonly<{
		rootFirst: number;
		childFirst: number;
		resultBytes: number;
		signal?: AbortSignal;
	}>,
): Readonly<{
	nodes: readonly TicketProjection[];
	pageInfo: Readonly<{ hasNextPage: boolean }>;
}> {
	if (input.signal?.aborted) throw input.signal.reason;
	if (
		!Number.isSafeInteger(input.rootFirst) ||
		input.rootFirst < 1 ||
		input.rootFirst > 100 ||
		!Number.isSafeInteger(input.childFirst) ||
		input.childFirst < 1 ||
		input.childFirst > 50
	)
		throw new TypeError("QP-DATA-012 executionLimitExceeded");
	if (rows.length > (input.rootFirst + 1) * input.childFirst)
		throw new TypeError("QP-DATA-012 executionLimitExceeded");

	const nodes: Array<{
		id: string;
		title: string;
		comments: Array<{ id: string; body?: string; createdAt: number }>;
	}> = [];
	let hasNextPage = false;
	let currentRootOrdinal = 0;
	let currentChildOrdinal = 0;
	let currentRootWasEmpty = false;
	let sentinelSeen = false;
	let current: (typeof nodes)[number] | null = null;

	for (const row of rows) {
		if (input.signal?.aborted) throw input.signal.reason;
		const rootOrdinal = integer(row.root_ordinal, "root ordinal");
		if (rootOrdinal < 1 || rootOrdinal > input.rootFirst + 1)
			throw new TypeError("invalid root ordinal");
		if (rootOrdinal < currentRootOrdinal)
			throw new TypeError("unordered root ordinal");
		if (rootOrdinal === input.rootFirst + 1) {
			if (currentRootOrdinal !== input.rootFirst)
				throw new TypeError("sentinel before a complete root page");
			hasNextPage = true;
			sentinelSeen = true;
			continue;
		}
		if (sentinelSeen) throw new TypeError("root after sentinel");
		if (rootOrdinal !== currentRootOrdinal) {
			if (rootOrdinal !== currentRootOrdinal + 1)
				throw new TypeError("non-contiguous root ordinal");
			currentRootOrdinal = rootOrdinal;
			currentChildOrdinal = 0;
			currentRootWasEmpty = false;
			current = {
				id: text(row.root_id, "root id"),
				title: text(row.root_title, "root title"),
				comments: [],
			};
			nodes.push(current);
		} else if (
			current === null ||
			current.id !== text(row.root_id, "root id") ||
			current.title !== text(row.root_title, "root title")
		) {
			throw new TypeError("inconsistent root group");
		}

		if (row.child_id === null) {
			if (row.child_ordinal !== null)
				throw new TypeError("forged empty child ordinal");
			if (currentChildOrdinal !== 0)
				throw new TypeError("empty marker after child");
			currentRootWasEmpty = true;
			continue;
		}
		if (currentRootWasEmpty) throw new TypeError("child after empty marker");
		const childOrdinal = integer(row.child_ordinal, "child ordinal");
		if (
			childOrdinal !== currentChildOrdinal + 1 ||
			childOrdinal > input.childFirst
		)
			throw new TypeError("invalid child ordinal");
		currentChildOrdinal = childOrdinal;
		if (current === null) throw new TypeError("child without root");
		if (typeof row.child_body_allowed !== "boolean")
			throw new TypeError("invalid child disclosure guard");
		current.comments.push({
			id: text(row.child_id, "child id"),
			createdAt: integer(row.child_created_at, "child createdAt"),
			...(row.child_body_allowed
				? { body: text(row.child_body, "child body") }
				: row.child_body === null
					? {}
					: (() => {
							throw new TypeError("forged denied child body");
						})()),
		});
	}

	const result = Object.freeze({
		nodes: Object.freeze(
			nodes.map((node) =>
				Object.freeze({ ...node, comments: Object.freeze(node.comments) }),
			),
		),
		pageInfo: Object.freeze({ hasNextPage }),
	});
	if (
		new TextEncoder().encode(JSON.stringify(result)).byteLength >
		input.resultBytes
	)
		throw new TypeError("QP-DATA-012 executionLimitExceeded");
	return result;
}
