// Re-export cn helper from lib/utils
export { cn } from "../lib/utils";
// Re-export field utilities
export {
	type AutoExpandFieldsConfig,
	autoExpandFields,
	hasFieldsToExpand,
} from "./auto-expand-fields";
export {
	type DetectRelationsConfig,
	detectManyToManyRelations,
	hasManyToManyRelations,
} from "./detect-relations";
// Re-export route utilities
export {
	type AdminRoutes,
	buildQueryString,
	type CollectionAction,
	createAdminRoutes,
	createAdminRoutesSimple,
	createNavigator,
	type ParsedRoute,
	parseCollectionRoute,
	parseGlobalRoute,
	withQuery,
} from "./routes";

/**
 * Utility functions for admin package
 */
