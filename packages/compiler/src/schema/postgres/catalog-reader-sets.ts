import {
	catalogColumnsStatement,
	catalogConstraintsStatement,
	catalogIndexesStatement,
	catalogIndexTermsStatement,
	catalogRelationsStatement,
	executeCatalogStatement,
	type CatalogColumnRow,
	type CatalogConstraintRow,
	type CatalogIndexRow,
	type CatalogIndexTermRow,
	type CatalogRelationRow,
	type CatalogStatementSql,
} from "./catalog-reader-statements";

export interface CatalogSchemaSets {
	readonly relations: readonly CatalogRelationRow[];
	readonly columns: readonly CatalogColumnRow[];
	readonly constraints: readonly CatalogConstraintRow[];
	readonly indexes: readonly CatalogIndexRow[];
	readonly indexTerms: readonly CatalogIndexTermRow[];
}

export async function readCatalogSchemaSets(
	sql: CatalogStatementSql,
	applicationSchema: string,
): Promise<CatalogSchemaSets> {
	const relations = await executeCatalogStatement(
		sql,
		catalogRelationsStatement,
		applicationSchema,
	);
	const columns = await executeCatalogStatement(
		sql,
		catalogColumnsStatement,
		applicationSchema,
	);
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
	return Object.freeze({
		relations,
		columns,
		constraints,
		indexes,
		indexTerms,
	});
}
