/**
 * Shared Global Meta Types
 *
 * Types for the global meta endpoint response.
 * Used by both backend and client.
 */

/**
 * Field metadata from global
 */
export interface GlobalFieldMeta {
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

/**
 * Global metadata response from /meta endpoint
 */
export interface GlobalMeta {
	/**
	 * Global name
	 */
	name: string;

	/**
	 * Field definitions
	 */
	fields: GlobalFieldMeta[];

	/**
	 * Whether timestamps (createdAt, updatedAt) are enabled
	 */
	timestamps: boolean;

	/**
	 * Whether versioning is enabled
	 */
	versioning: boolean;

	/**
	 * Names of virtual/computed fields
	 */
	virtualFields: string[];

	/**
	 * Names of localized fields
	 */
	localizedFields: string[];
}
