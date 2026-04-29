/**
 * Reactive Field System — Plain Types
 *
 * Pure type definitions for reactive field behaviors. No runtime code.
 * Introspection and other modules that need only the contract shape
 * should import from here instead of reactive.ts.
 *
 * @module
 */

import type { I18nText } from "#questpie/shared/i18n/types.js";

// ============================================================================
// Reactive Context
// ============================================================================

export interface ReactiveServerContext {
	db: unknown;
	user: unknown | null;
	req: Request;
	locale: string;
}

export interface ReactiveContext<T = Record<string, any>> {
	data: T;
	sibling: Record<string, any>;
	prev: {
		data: T;
		sibling: Record<string, any>;
	};
	ctx: ReactiveServerContext;
}

// ============================================================================
// Reactive Config Types
// ============================================================================

export type ReactiveHandler<TReturn> = (
	ctx: ReactiveContext,
) => TReturn | Promise<TReturn>;

export type ReactiveConfig<TReturn> =
	| ReactiveHandler<TReturn>
	| {
			handler: ReactiveHandler<TReturn>;
			deps?: string[] | ((ctx: ReactiveContext) => any[]);
			debounce?: number;
	  };

// ============================================================================
// Options Context
// ============================================================================

export interface OptionsContext<T = Record<string, any>> {
	data: T;
	sibling: Record<string, any>;
	search: string;
	page: number;
	limit: number;
	ctx: ReactiveServerContext;
}

export type OptionsHandler<T = Record<string, any>> = (
	ctx: OptionsContext<T>,
) => OptionsResult | Promise<OptionsResult>;

export interface OptionsResult {
	options: Array<{ value: string | number; label: I18nText }>;
	hasMore?: boolean;
	total?: number;
}

export interface OptionsConfig<T = Record<string, any>> {
	handler: OptionsHandler<T>;
	deps?: string[] | ((ctx: OptionsContext<T>) => any[]);
}

// ============================================================================
// Reactive Admin Meta
// ============================================================================

export interface ReactiveAdminMeta {
	hidden?: boolean | ReactiveConfig<boolean>;
	readOnly?: boolean | ReactiveConfig<boolean>;
	disabled?: boolean | ReactiveConfig<boolean>;
	compute?: ReactiveConfig<any>;
}

// ============================================================================
// Serialized Contracts (for client introspection)
// ============================================================================

export interface SerializedReactiveConfig {
	watch: string[];
	debounce?: number;
}

// ============================================================================
// Reactive Prop Values (per-field-instance escape hatch)
// ============================================================================

/**
 * Reactive prop placeholder — what the wire sees in place of a function value
 * for an arbitrary field-component prop (e.g. relation `filter`).
 *
 * The function itself stays on the server; the client receives this descriptor
 * and resolves the actual value by calling `/admin/reactive` with
 * `{ type: "prop", field, propPath, formData }`.
 *
 * The `~reactive` discriminator is intentionally namespaced to avoid colliding
 * with ordinary JSON shapes that callers might legitimately store under a
 * `props` key (e.g. `{ filter: { role: "admin" } }`).
 */
export interface ReactivePropPlaceholder extends SerializedReactiveConfig {
	"~reactive": "prop";
}

/**
 * Reactive prop value — supports static JSON, raw handler function, or a full
 * config (handler + deps + debounce). Handler / config get serialized to a
 * `ReactivePropPlaceholder` during introspection.
 */
export type ReactivePropValue<TReturn = unknown> =
	| TReturn
	| ReactiveHandler<TReturn>
	| {
			handler: ReactiveHandler<TReturn>;
			deps?: string[] | ((ctx: ReactiveContext) => any[]);
			debounce?: number;
	  };

export interface SerializedOptionsConfig {
	watch: string[];
	searchable: boolean;
	paginated: boolean;
}

export interface TrackingResult<T> {
	result: T;
	deps: string[];
}
