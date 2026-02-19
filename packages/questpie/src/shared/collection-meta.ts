/**
 * Shared Collection Meta Types
 *
 * Types for the collection meta endpoint response.
 * Used by both backend and client.
 */

/**
 * Title field metadata
 */
export interface CollectionTitleMeta {
	/**
	 * Whether a title is defined on the collection
	 */
	defined: boolean;

	/**
	 * Type of title expression:
	 * - "field": Title maps to a regular field (sortable)
	 * - "virtual": Title maps to a virtual/computed field
	 * - null: No title defined
	 */
	type: "field" | "virtual" | null;

	/**
	 * The field name that provides the title
	 */
	fieldName: string | null;
}

/**
 * Field metadata from collection
 */
export interface CollectionFieldMeta {
	/**
	 * Field name
	 */
	name: string;

	/**
	 * Whether field is localized (i18n)
	 */
	localized: boolean;

	/**
	 * Whether field is virtual/computed
	 */
	virtual: boolean;
}

export interface WorkflowStageMeta {
	name: string;
	label?: string;
	description?: string;
	transitions?: string[];
}

export interface WorkflowMeta {
	enabled: boolean;
	initialStage: string;
	stages: WorkflowStageMeta[];
}

/**
 * Collection metadata response from /meta endpoint
 */
export interface CollectionMeta {
	/**
	 * Collection name
	 */
	name: string;

	/**
	 * Field definitions
	 */
	fields: CollectionFieldMeta[];

	/**
	 * Title metadata
	 */
	title: CollectionTitleMeta;

	/**
	 * Whether timestamps (createdAt, updatedAt) are enabled
	 */
	timestamps: boolean;

	/**
	 * Whether soft delete is enabled
	 */
	softDelete: boolean;

	/**
	 * Names of virtual/computed fields
	 */
	virtualFields: string[];

	/**
	 * Names of localized fields
	 */
	localizedFields: string[];

	/**
	 * Names of relations
	 */
	relations: string[];

	/**
	 * Workflow configuration metadata
	 */
	workflow?: WorkflowMeta;
}
