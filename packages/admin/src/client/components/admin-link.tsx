/**
 * AdminLink Component
 *
 * A type-safe link component for navigating within the admin UI.
 * Automatically generates correct URLs based on collection, global, or page targets.
 */

import type { Questpie } from "questpie";
import * as React from "react";
import type { CollectionNames, GlobalNames } from "../builder";
import {
	type AdminLinkProps as AdminLinkTargetProps,
	getAdminLinkHref,
	useAdminRoutes,
} from "../hooks/use-admin-routes";

// ============================================================================
// Types
// ============================================================================

interface AdminLinkProps<TApp extends Questpie<any>>
	extends Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
	/** Link to dashboard */
	to?: "dashboard";
	/** Link to collection */
	collection?: CollectionNames<TApp>;
	/** Collection action */
	action?: "list" | "create" | "edit";
	/** Item ID for edit action */
	id?: string;
	/** Link to global */
	global?: GlobalNames<TApp>;
	/** Link to custom page by ID */
	pageId?: string;
	/** Custom href (overrides other props) */
	href?: string;
	/** Whether to use the navigate function instead of native anchor */
	useNavigate?: boolean;
	/** Children */
	children: React.ReactNode;
}

// ============================================================================
// Component
// ============================================================================

/**
 * Type-safe link component for admin navigation
 *
 * @example
 * ```tsx
 * // Link to dashboard
 * <AdminLink to="dashboard">Dashboard</AdminLink>
 *
 * // Link to collection list
 * <AdminLink collection="posts">View Posts</AdminLink>
 *
 * // Link to create new item
 * <AdminLink collection="posts" action="create">New Post</AdminLink>
 *
 * // Link to edit item
 * <AdminLink collection="posts" action="edit" id="123">Edit Post</AdminLink>
 *
 * // Link to global
 * <AdminLink global="siteSettings">Site Settings</AdminLink>
 *
 * // Link to custom page
 * <AdminLink pageId="analytics">Analytics</AdminLink>
 * ```
 */
export function AdminLink<TApp extends Questpie<any>>({
	to,
	collection,
	action,
	id,
	global,
	pageId,
	href: customHref,
	useNavigate = false,
	children,
	onClick,
	...rest
}: AdminLinkProps<TApp>) {
	const { routes } = useAdminRoutes<TApp>();

	// Determine the href
	const href = React.useMemo(() => {
		if (customHref) return customHref;

		const targetProps: AdminLinkTargetProps<TApp> = {
			to,
			collection,
			action,
			id,
			global,
			pageId,
		};

		return getAdminLinkHref(routes, targetProps);
	}, [customHref, to, collection, action, id, global, pageId, routes]);

	// Handle click for navigate mode
	const handleClick = React.useCallback(
		(e: React.MouseEvent<HTMLAnchorElement>) => {
			if (onClick) {
				onClick(e);
			}

			if (useNavigate && !e.defaultPrevented) {
				e.preventDefault();
				// Navigate will be called via routes context
				if (typeof window !== "undefined") {
					window.history.pushState({}, "", href);
					window.dispatchEvent(new PopStateEvent("popstate"));
				}
			}
		},
		[onClick, useNavigate, href],
	);

	return (
		<a href={href} onClick={handleClick} {...rest}>
			{children}
		</a>
	);
}

// ============================================================================
// Convenience Components
// ============================================================================

/**
 * Link to a collection list
 */
function CollectionLink<TApp extends Questpie<any>>({
	collection,
	...rest
}: Omit<AdminLinkProps<TApp>, "to" | "global" | "pageId" | "action" | "id"> & {
	collection: CollectionNames<TApp>;
}) {
	return <AdminLink<TApp> collection={collection} action="list" {...rest} />;
}

/**
 * Link to create a new item in a collection
 */
function CollectionCreateLink<TApp extends Questpie<any>>({
	collection,
	...rest
}: Omit<AdminLinkProps<TApp>, "to" | "global" | "pageId" | "action" | "id"> & {
	collection: CollectionNames<TApp>;
}) {
	return <AdminLink<TApp> collection={collection} action="create" {...rest} />;
}

/**
 * Link to edit an item in a collection
 */
export function CollectionEditLink<TApp extends Questpie<any>>({
	collection,
	id,
	...rest
}: Omit<AdminLinkProps<TApp>, "to" | "global" | "pageId" | "action"> & {
	collection: CollectionNames<TApp>;
	id: string;
}) {
	return (
		<AdminLink<TApp> collection={collection} action="edit" id={id} {...rest} />
	);
}

/**
 * Link to a global settings page
 */
function GlobalLink<TApp extends Questpie<any>>({
	global,
	...rest
}: Omit<
	AdminLinkProps<TApp>,
	"to" | "collection" | "pageId" | "action" | "id"
> & {
	global: GlobalNames<TApp>;
}) {
	return <AdminLink<TApp> global={global} {...rest} />;
}

/**
 * Link to dashboard
 */
function DashboardLink<TApp extends Questpie<any>>(
	props: Omit<
		AdminLinkProps<TApp>,
		"to" | "collection" | "global" | "pageId" | "action" | "id"
	>,
) {
	return <AdminLink<TApp> to="dashboard" {...props} />;
}
