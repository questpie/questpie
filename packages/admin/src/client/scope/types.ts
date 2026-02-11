/**
 * Scope Primitives Types
 *
 * Types for the scope selection system used in multi-tenant applications.
 */

/**
 * Scope context value provided by ScopeProvider
 */
export interface ScopeContextValue {
	/** Current scope ID (null = no scope selected / global) */
	scopeId: string | null;
	/** Set the current scope */
	setScope: (id: string | null) => void;
	/** Clear the scope (set to null) */
	clearScope: () => void;
	/** Header name used for API requests */
	headerName: string;
	/** Whether scope is currently being loaded */
	isLoading?: boolean;
}

/**
 * Props for ScopeProvider component
 */
export interface ScopeProviderProps {
	children: React.ReactNode;
	/**
	 * HTTP header name to use for scope ID in API requests.
	 * @example "x-selected-property"
	 * @example "x-tenant-id"
	 */
	headerName: string;
	/**
	 * localStorage key for persisting the selected scope.
	 * If not provided, scope won't be persisted.
	 * @example "admin-selected-property"
	 */
	storageKey?: string;
	/**
	 * Default scope ID to use if none is stored.
	 */
	defaultScope?: string | null;
}

/**
 * Option for ScopePicker
 */
export interface ScopeOption {
	value: string;
	label: string;
	description?: string;
	icon?: React.ReactNode;
}

/**
 * Props for ScopePicker component
 */
export interface ScopePickerProps {
	/**
	 * Collection to fetch options from.
	 * @example "properties"
	 * @example "organizations"
	 */
	collection?: string;
	/**
	 * Field to use as the label for options.
	 * @default "name"
	 */
	labelField?: string;
	/**
	 * Field to use as the value for options.
	 * @default "id"
	 */
	valueField?: string;
	/**
	 * Static options (alternative to collection-based options).
	 */
	options?: ScopeOption[];
	/**
	 * Async function to load options.
	 */
	loadOptions?: () => Promise<ScopeOption[]>;
	/**
	 * Placeholder text when no scope is selected.
	 * @default "Select..."
	 */
	placeholder?: string;
	/**
	 * Label shown above the picker.
	 */
	label?: string;
	/**
	 * Allow clearing the selection (show "All" option).
	 * @default false
	 */
	allowClear?: boolean;
	/**
	 * Text for the clear/all option.
	 * @default "All"
	 */
	clearText?: string;
	/**
	 * Additional CSS class name.
	 */
	className?: string;
	/**
	 * Render as compact (no label, smaller).
	 * @default false
	 */
	compact?: boolean;
}
