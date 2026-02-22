/**
 * Relation Mutations
 *
 * Functions for handling relation mutations (cascade delete, nested operations).
 */

export {
	type CascadeDeleteOptions,
	handleCascadeDelete,
} from "./cascade-delete.js";

export {
	applyBelongsToRelations,
	extractBelongsToConnectValues,
	type ProcessNestedRelationsOptions,
	processHasManyNestedOperations,
	processManyToManyNestedOperations,
	processNestedRelations,
	separateNestedRelations,
	transformSimpleRelationValues,
} from "./nested-operations.js";
