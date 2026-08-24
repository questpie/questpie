import type { SQL } from "bun";

import { canonicalBytes, compareAscii } from "../../canonical";
import { parseCatalogCheck } from "./catalog-expression";
import {
	catalogConstraintsStatement,
	catalogIndexesStatement,
	catalogIndexTermsStatement,
	type CatalogConstraintRow,
	type CatalogIndexRow,
	type CatalogIndexTermRow,
} from "./catalog-reader-statements";
import type {
	CatalogAccumulator,
	CatalogColumn,
	CatalogTable,
} from "./catalog-reader-types";

export interface CatalogConstraintAndIndexRows {
	readonly constraints: readonly CatalogConstraintRow[];
	readonly indexes: readonly CatalogIndexRow[];
	readonly indexTerms: readonly CatalogIndexTermRow[];
}

async function executeCatalogStatement<Row>(
	sql: SQL,
	statement: Readonly<{
		text: string;
		decode(
			result: Readonly<{
				command: string;
				rowCount: number | null;
				rows: readonly (readonly unknown[])[];
			}>,
		): readonly Row[];
	}>,
	applicationSchema: string,
): Promise<readonly Row[]> {
	const rows = (await sql
		.unsafe(statement.text, [applicationSchema])
		.values()) as unknown as readonly (readonly unknown[])[] & {
		readonly command: string;
		readonly count: number;
	};
	return statement.decode({
		command: rows.command,
		rowCount: rows.count,
		rows,
	});
}

export async function readCatalogConstraintsAndIndexes(
	sql: SQL,
	applicationSchema: string,
): Promise<CatalogConstraintAndIndexRows> {
	const constraints = await executeCatalogStatement(
		sql,
		catalogConstraintsStatement,
		applicationSchema,
	);
	const indexes = await executeCatalogStatement(
		sql,
		catalogIndexesStatement,
		applicationSchema,
	);
	const indexTerms = await executeCatalogStatement(
		sql,
		catalogIndexTermsStatement,
		applicationSchema,
	);
	return { constraints, indexes, indexTerms };
}

export function reduceCatalogTableConstraintsAndIndexes(
	applicationSchema: string,
	table: CatalogTable,
	columns: readonly CatalogColumn[],
	rows: CatalogConstraintAndIndexRows,
	state: CatalogAccumulator,
): void {
	readConstraints(
		applicationSchema,
		table,
		columns,
		rows.constraints.filter((constraint) => constraint.table === table.name),
		state,
	);
	readIndexes(applicationSchema, table, rows, state);
}

function readConstraints(
	applicationSchema: string,
	table: CatalogTable,
	columns: readonly CatalogColumn[],
	constraints: readonly CatalogConstraintRow[],
	state: CatalogAccumulator,
): void {
	const notNullConstraints = constraints.filter(
		(constraint) => constraint.type === "n",
	);
	const notNullFields = columns
		.filter((column) => !column.nullable)
		.map((column) => column.name)
		.sort(compareAscii);
	const validNotNullConstraints =
		notNullConstraints.length === 0 ||
		(notNullConstraints.every(
			(constraint) =>
				constraint.fields.length === 1 &&
				constraint.validated &&
				!constraint.deferrable &&
				!constraint.initiallyDeferred &&
				constraint.enforced &&
				!constraint.period &&
				constraint.local &&
				constraint.inheritedCount === 0 &&
				!constraint.noInherit,
		) &&
			canonicalBytes(
				notNullConstraints
					.map((constraint) => constraint.fields[0]!)
					.sort(compareAscii),
			) === canonicalBytes(notNullFields));
	if (!validNotNullConstraints)
		for (const constraint of notNullConstraints)
			state.unsupportedObjects.push(
				unsupportedConstraint(applicationSchema, table.name, constraint.name),
			);
	for (const constraint of constraints) {
		if (constraint.type === "n") continue;
		if (!constraint.enforced || constraint.period) {
			state.unsupportedObjects.push(
				unsupportedConstraint(applicationSchema, table.name, constraint.name),
			);
			continue;
		}
		if (constraint.type === "c") {
			if (
				!constraint.local ||
				constraint.inheritedCount !== 0 ||
				constraint.noInherit ||
				constraint.deferrable ||
				constraint.initiallyDeferred
			) {
				state.unsupportedObjects.push(
					unsupportedConstraint(applicationSchema, table.name, constraint.name),
				);
				continue;
			}
			const expression =
				constraint.definition === null
					? null
					: parseCatalogCheck(constraint.definition);
			if (expression)
				state.objects.push({
					kind: "check",
					table: table.name,
					name: constraint.name,
					expression,
					validated: constraint.validated,
				});
			else
				state.unsupportedObjects.push(
					unsupportedConstraint(applicationSchema, table.name, constraint.name),
				);
			continue;
		}
		if (constraint.type === "p" || constraint.type === "u")
			state.objects.push({
				kind: constraint.type === "p" ? "primaryKey" : "unique",
				table: table.name,
				name: constraint.name,
				fields: constraint.fields,
				validated: constraint.validated,
				deferrable: constraint.deferrable,
				initiallyDeferred: constraint.initiallyDeferred,
			});
		else if (constraint.type === "f") {
			const onDelete = foreignKeyAction(constraint.onDelete);
			const onUpdate = foreignKeyAction(constraint.onUpdate);
			if (
				onDelete &&
				onUpdate &&
				constraint.matchType === "s" &&
				constraint.deleteSetFieldCount === 0 &&
				constraint.referencedNamespace === applicationSchema
			)
				state.objects.push({
					kind: "foreignKey",
					table: table.name,
					name: constraint.name,
					fields: constraint.fields,
					referencedTable: constraint.referencedTable,
					referencedFields: constraint.referencedFields,
					onDelete,
					onUpdate,
					validated: constraint.validated,
					deferrable: constraint.deferrable,
					initiallyDeferred: constraint.initiallyDeferred,
				});
			else
				state.unsupportedObjects.push(
					unsupportedConstraint(applicationSchema, table.name, constraint.name),
				);
		} else
			state.unsupportedObjects.push(
				unsupportedConstraint(applicationSchema, table.name, constraint.name),
			);
	}
}

function readIndexes(
	applicationSchema: string,
	table: CatalogTable,
	rows: CatalogConstraintAndIndexRows,
	state: CatalogAccumulator,
): void {
	const indexes = rows.indexes.filter((index) => index.table === table.name);
	for (const index of indexes) {
		const terms = rows.indexTerms.filter(
			(term) => term.table === table.name && term.index === index.name,
		);
		for (const term of terms) {
			const dependency = {
				kind: "operatorClass",
				schema: term.operatorClassNamespace,
				name: term.operatorClass,
				extension: term.operatorClassExtension,
			};
			state.dependencies.set(canonicalBytes(dependency), dependency);
		}
		const hasSupportedIndexState = (unique: boolean, requireReady: boolean) =>
			index.method === "btree" &&
			index.unique === unique &&
			(!requireReady || (index.valid && index.ready)) &&
			index.predicate === null &&
			!index.hasExpressions &&
			!index.nullsNotDistinct &&
			index.totalTermCount === index.keyTermCount &&
			terms.length === index.keyTermCount &&
			terms.every(
				(term, position) =>
					term.position === position + 1 &&
					term.field !== null &&
					term.operatorClassDefault &&
					term.operatorClassNamespace === "pg_catalog" &&
					(term.collation === null ||
						(term.collationNamespace === "pg_catalog" &&
							term.collation === "C")),
			);
		if (index.constraintBacked) {
			if (!hasSupportedIndexState(true, true)) {
				const constraintIndex = state.objects.findIndex(
					(object) =>
						(object.kind === "primaryKey" || object.kind === "unique") &&
						object.table === table.name &&
						object.name === index.constraintName,
				);
				if (constraintIndex >= 0) state.objects.splice(constraintIndex, 1);
				state.unsupportedObjects.push(
					unsupportedConstraint(
						applicationSchema,
						table.name,
						String(index.constraintName),
					),
				);
			}
			continue;
		}
		if (!hasSupportedIndexState(false, false)) {
			state.unsupportedObjects.push({
				kind: "other",
				qualifiedIdentity: `${applicationSchema}.${index.name}`,
				attachedTo: `${applicationSchema}.${table.name}`,
			});
			continue;
		}
		state.objects.push({
			kind: "index",
			table: table.name,
			name: index.name,
			method: "btree",
			unique: false,
			fields: terms.map((term) => ({
				field: term.field,
				order: (term.options & 1) === 1 ? "desc" : "asc",
				nulls: (term.options & 2) === 2 ? "first" : "last",
				operatorClass: "typeDefault",
				collation: term.collation === "C" ? "field" : null,
			})),
			predicate: null,
			valid: index.valid,
			ready: index.ready,
		});
	}
}

function unsupportedConstraint(
	applicationSchema: string,
	table: string,
	constraint: string,
) {
	return {
		kind: "other",
		qualifiedIdentity: `${applicationSchema}.${table}.${constraint}`,
		attachedTo: `${applicationSchema}.${table}`,
	};
}

function foreignKeyAction(value: string): string | undefined {
	if (value === "a") return "noAction";
	if (value === "r") return "restrict";
	if (value === "c") return "cascade";
	if (value === "n") return "setNull";
	return undefined;
}
