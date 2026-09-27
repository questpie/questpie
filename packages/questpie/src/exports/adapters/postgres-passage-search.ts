import { PostgresSearchAdapter } from "#questpie/server/modules/core/integrated/search/adapters/postgres.js";
import {
	searchDocuments,
	searchPassages,
} from "#questpie/server/modules/core/integrated/search/passages/schema.js";

/** Requires the pgvector extension to be provisioned before applying generated migrations. */
export class PostgresPassageSearchAdapter extends PostgresSearchAdapter {
	getTableSchemas() {
		return {
			...super.getTableSchemas(),
			questpie_search_documents: searchDocuments,
			questpie_search_passages: searchPassages,
		};
	}
}
