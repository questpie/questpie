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
	isForeignKeyViolation,
	isPurgeLockTimeout,
	lockRelationSourceForWrite,
	lockRelationTargetsForWrite,
	preparePurgeRelations,
	type PreparedPurgeRelations,
	retainedReferenceConflict,
} from "./purge-relations.js";

export {
	applyBelongsToRelations,
	collapsePolymorphicRelationValues,
	expandPolymorphicRelationValues,
	extractBelongsToConnectValues,
	type ProcessNestedRelationsOptions,
	processHasManyNestedOperations,
	processManyToManyNestedOperations,
	processNestedRelations,
	separateNestedRelations,
	transformSimpleRelationValues,
} from "./nested-operations.js";
