/**
 * Component Renderer
 *
 * Resolves server-defined component references to React components.
 * This is the bridge between server config (serializable references)
 * and client rendering (React components).
 *
 * @example
 * ```tsx
 * // Server sends: { type: "icon", props: { name: "ph:users" } }
 * // Client renders: <IconifyIcon name="ph:users" />
 *
 * <ComponentRenderer reference={{ type: "icon", props: { name: "ph:users" } }} />
 * ```
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import type { ComponentReference } from "#questpie/admin/server";
import { selectAdmin, useAdminStore } from "../runtime";

// ============================================================================
// Icon Component
// ============================================================================

/**
 * Props for IconifyIcon component
 */
export interface IconifyIconProps {
	/** Iconify icon name (e.g., "ph:users", "mdi:home") */
	name: string;
	/** Icon size */
	size?: number | string;
	/** Additional class name */
	className?: string;
	/** Icon color */
	color?: string;
}

/**
 * Iconify-based icon component.
 * Renders icons from any Iconify icon set (Phosphor, Material Design, etc.)
 *
 * @example
 * ```tsx
 * <IconifyIcon name="ph:users" size={24} />
 * <IconifyIcon name="mdi:home" className="text-blue-500" />
 * ```
 */
export const IconifyIcon = React.memo(function IconifyIcon({
	name,
	size,
	className,
	color,
}: IconifyIconProps): React.ReactElement {
	return (
		<Icon
			icon={name}
			width={size}
			height={size}
			className={className}
			color={color}
		/>
	);
});

// ============================================================================
// Badge Component
// ============================================================================

/**
 * Props for Badge component
 */
export interface BadgeProps {
	/** Badge text */
	text: string;
	/** Badge color variant */
	color?:
		| "default"
		| "primary"
		| "secondary"
		| "destructive"
		| "success"
		| "warning";
	/** Additional class name */
	className?: string;
}

/**
 * Badge component for status indicators
 */
export function Badge({
	text,
	color = "default",
	className,
}: BadgeProps): React.ReactElement {
	const colorClasses: Record<string, string> = {
		default: "bg-muted text-muted-foreground",
		primary: "bg-primary/10 text-primary",
		secondary: "bg-secondary text-secondary-foreground",
		destructive: "bg-destructive/10 text-destructive",
		success: "bg-success/10 text-success",
		warning: "bg-warning/10 text-warning",
	};

	return (
		<span
			className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${colorClasses[color] ?? colorClasses.default} ${className ?? ""}`}
		>
			{text}
		</span>
	);
}

// ============================================================================
// Component Registry
// ============================================================================

/**
 * Component renderer registry type
 */
export type ComponentRendererRegistry = Record<
	string,
	React.ComponentType<any>
>;

// ============================================================================
// Component Renderer
// ============================================================================

/**
 * Props for ComponentRenderer
 */
export interface ComponentRendererProps {
	/** Server-defined component reference */
	reference: ComponentReference | null | undefined;
	/** Component registry override (defaults to admin context registry) */
	registry?: ComponentRendererRegistry;
	/** Fallback to render if component type not found */
	fallback?: React.ReactNode;
	/** Additional props to pass to the component */
	additionalProps?: Record<string, unknown>;
}

function shallowEqualRecord(
	a: Record<string, unknown> | undefined,
	b: Record<string, unknown> | undefined,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;

	const aKeys = Object.keys(a);
	const bKeys = Object.keys(b);

	if (aKeys.length !== bKeys.length) return false;

	for (const key of aKeys) {
		if (a[key] !== b[key]) {
			return false;
		}
	}

	return true;
}

function areRendererPropsEqual(
	prev: ComponentRendererProps,
	next: ComponentRendererProps,
): boolean {
	if (prev.registry !== next.registry) return false;
	if (prev.fallback !== next.fallback) return false;
	if (!shallowEqualRecord(prev.additionalProps, next.additionalProps)) {
		return false;
	}

	if (prev.reference === next.reference) return true;
	if (!prev.reference || !next.reference) return false;
	if (prev.reference.type !== next.reference.type) return false;

	return shallowEqualRecord(
		prev.reference.props as Record<string, unknown> | undefined,
		next.reference.props as Record<string, unknown> | undefined,
	);
}

type RegistryRendererProps = {
	reference: ComponentReference;
	registry?: ComponentRendererRegistry;
	fallback?: React.ReactNode;
	additionalProps?: Record<string, unknown>;
};

function RegistryComponentRenderer({
	reference,
	registry,
	fallback,
	additionalProps,
}: RegistryRendererProps): React.ReactNode {
	const admin = useAdminStore(selectAdmin);
	const contextRegistry =
		(admin?.getComponents?.() as ComponentRendererRegistry | undefined) ?? {};
	const mergedRegistry = registry ?? contextRegistry;
	const Component = mergedRegistry[reference.type];

	if (!Component) {
		if (process.env.NODE_ENV === "development") {
			console.warn(
				`[ComponentRenderer] Unknown component type: "${reference.type}". ` +
					`Available types: ${Object.keys(mergedRegistry).join(", ")}`,
			);
		}
		return fallback ?? null;
	}

	return <Component {...reference.props} {...additionalProps} />;
}

/**
 * Renders a server-defined component reference.
 *
 * Looks up the component type in the registry and renders it with the provided props.
 * Falls back gracefully if the component type is not found.
 *
 * @example
 * ```tsx
 * // Basic usage
 * <ComponentRenderer reference={{ type: "icon", props: { name: "ph:users" } }} />
 *
 * // With custom registry
 * <ComponentRenderer
 *   reference={{ type: "custom", props: { value: 42 } }}
 *   registry={{ custom: MyCustomComponent }}
 * />
 *
 * // With fallback
 * <ComponentRenderer
 *   reference={{ type: "unknown", props: {} }}
 *   fallback={<span>?</span>}
 * />
 * ```
 */
export const ComponentRenderer = React.memo(function ComponentRenderer({
	reference,
	registry,
	fallback = null,
	additionalProps,
}: ComponentRendererProps): React.ReactNode {
	if (!reference) {
		return fallback;
	}

	if (reference.type === "icon") {
		const iconProps = (reference.props ?? {}) as Record<string, unknown>;
		const iconName = iconProps.name;

		if (typeof iconName === "string") {
			const { name: _name, ...rest } = iconProps;
			return <Icon icon={iconName} {...rest} {...additionalProps} />;
		}
	}

	return (
		<RegistryComponentRenderer
			reference={reference}
			registry={registry}
			fallback={fallback}
			additionalProps={additionalProps}
		/>
	);
}, areRendererPropsEqual);

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Check if a value is a component reference
 */
export function isComponentReference(
	value: unknown,
): value is ComponentReference {
	return (
		typeof value === "object" &&
		value !== null &&
		"type" in value &&
		"props" in value &&
		typeof (value as any).type === "string" &&
		typeof (value as any).props === "object"
	);
}

/**
 * Resolve an icon to a React element.
 * Handles both ComponentReference objects and direct React components.
 *
 * @param icon - Icon to resolve (ComponentReference, React component, or undefined)
 * @param props - Additional props to pass to the icon
 * @returns React element or null
 */
export function resolveIconElement(
	icon:
		| ComponentReference
		| React.ComponentType<any>
		| string
		| undefined
		| null,
	props?: Record<string, unknown>,
	registry?: ComponentRendererRegistry,
): React.ReactNode {
	if (!icon) {
		return null;
	}

	// Handle ComponentReference
	if (isComponentReference(icon)) {
		return (
			<ComponentRenderer
				reference={icon}
				additionalProps={props}
				registry={registry}
			/>
		);
	}

	// Handle legacy string icon names by treating them as icon component references
	if (typeof icon === "string") {
		return (
			<ComponentRenderer
				reference={{ type: "icon", props: { name: icon } }}
				additionalProps={props}
				registry={registry}
			/>
		);
	}

	// Handle React component
	if (typeof icon === "function") {
		const IconComponent = icon;
		return <IconComponent {...props} />;
	}

	// Handle object that might be a React element
	if (typeof icon === "object" && React.isValidElement(icon)) {
		return icon;
	}

	return null;
}

/**
 * Create a render function for icons.
 * Useful for rendering icons in table cells or list items.
 *
 * @param registry - Custom component registry
 * @returns Function that renders an icon from a ComponentReference
 */
export function createIconRenderer(registry?: ComponentRendererRegistry) {
	return (
		icon:
			| ComponentReference
			| React.ComponentType<any>
			| string
			| undefined
			| null,
		props?: Record<string, unknown>,
	): React.ReactNode => {
		if (!icon) return null;

		return resolveIconElement(icon, props, registry);
	};
}
