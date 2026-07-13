/**
 * ResourceSheet Component
 *
 * Universal sheet component for viewing/editing collections and globals.
 * Uses FormView/GlobalFormView internally for consistent UI and behavior.
 * Container queries provide automatic responsive layout.
 *
 * @example
 * ```tsx
 * // Collection usage
 * <ResourceSheet
 *   type="collection"
 *   collection="posts"
 *   itemId="123"
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   onSave={(data) => console.log('Saved:', data)}
 * />
 *
 * // Global usage
 * <ResourceSheet
 *   type="global"
 *   global="siteSettings"
 *   open={isOpen}
 *   onOpenChange={setIsOpen}
 *   onSave={(data) => console.log('Saved:', data)}
 * />
 * ```
 */

import { Icon } from "@iconify/react";
import * as React from "react";

import type { ComponentReference } from "#questpie/admin/server/augmentation.js";

import { useAdminConfig } from "../../hooks/use-admin-config";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import type { I18nText } from "../../i18n/types";
import {
	LocaleScopeProvider,
	selectBasePath,
	selectNavigate,
	useAdminStore,
} from "../../runtime";
import FormView from "../../views/collection/form-view";
import GlobalFormView from "../../views/globals/global-form-view";
import { resolveIconElement } from "../component-renderer";
import { Button } from "../ui/button";
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetHeader,
	SheetTitle,
} from "../ui/sheet";

// ============================================================================
// Types
// ============================================================================

/**
 * Base props shared between collection and global sheets
 */
interface ResourceSheetBaseProps {
	/**
	 * Is sheet open
	 */
	open: boolean;

	/**
	 * Callback when sheet open state changes
	 */
	onOpenChange: (open: boolean) => void;

	/**
	 * Callback after successful save
	 * Receives the saved data
	 */
	onSave?: (data: any) => void;

	/**
	 * Side of the screen where sheet appears
	 * @default "right"
	 */
	side?: "top" | "right" | "bottom" | "left";
}

/**
 * Props for collection resource type
 */
interface CollectionSheetProps extends ResourceSheetBaseProps {
	type: "collection";

	/**
	 * Collection name
	 */
	collection: string;

	/**
	 * Item ID (undefined for create, string for edit)
	 */
	itemId?: string;

	/**
	 * Default values for create mode (prefill)
	 * Useful for pre-populating relation fields when creating from a parent context
	 */
	defaultValues?: Record<string, any>;
}

/**
 * Props for global resource type
 */
interface GlobalSheetProps extends ResourceSheetBaseProps {
	type: "global";

	/**
	 * Global name
	 */
	global: string;
}

/**
 * Discriminated union of all resource sheet props
 */
type ResourceSheetProps = CollectionSheetProps | GlobalSheetProps;

// ============================================================================
// Component
// ============================================================================

export function ResourceSheet(props: ResourceSheetProps) {
	const { open, onOpenChange, onSave, side = "right" } = props;
	const navigate = useAdminStore(selectNavigate);
	const basePath = useAdminStore(selectBasePath);
	const { t } = useTranslation();
	const resolveText = useResolveText();
	const { data: serverConfig } = useAdminConfig();

	const handleSuccess = React.useCallback(
		(data: any) => {
			onSave?.(data);
			onOpenChange(false);
		},
		[onSave, onOpenChange],
	);

	// Header context: which resource this sheet edits, and in which mode. The
	// nested form shows the record title; without the collection name a nested
	// editor is indistinguishable from the page underneath (you can save the
	// wrong record without noticing). Server config entries are untyped plain
	// objects — narrow to just the two fields the header reads.
	const resourceConfig = (
		props.type === "collection"
			? serverConfig?.collections?.[props.collection]
			: serverConfig?.globals?.[props.global]
	) as { label?: I18nText; icon?: ComponentReference | string } | undefined;
	const resourceLabel =
		resolveText(resourceConfig?.label) ||
		(props.type === "collection" ? props.collection : props.global);
	const modeLabel =
		props.type === "collection"
			? props.itemId
				? t("common.edit")
				: t("common.create")
			: t("common.edit");
	const resourceIcon = resolveIconElement(resourceConfig?.icon, {
		className: "size-3.5 text-muted-foreground shrink-0",
	});

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side={side}
				showCloseButton={false}
				className="qa-resource-sheet flex flex-col gap-0 p-0"
			>
				{/* Close lives INSIDE the header row so `items-center` aligns it with
				    the title (the generic absolute top-3 close doesn't know the
				    header height and sat too low). */}
				<SheetHeader className="qa-resource-sheet__header border-border-subtle shrink-0 flex-row items-center gap-1.5 border-b py-2.5 pr-2.5 pl-4">
					{resourceIcon}
					<span className="text-muted-foreground max-w-[35%] truncate text-sm">
						{resourceLabel}
					</span>
					<span className="text-muted-foreground/60 text-sm" aria-hidden>
						›
					</span>
					<SheetTitle className="truncate">{modeLabel}</SheetTitle>
					<SheetClose
						render={
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								className="ml-auto shrink-0"
								aria-label={t("common.close")}
							/>
						}
					>
						<Icon icon="ph:x" className="size-4" />
					</SheetClose>
				</SheetHeader>
				<div className="qa-resource-sheet__body flex-1 overflow-y-auto p-6 pt-4">
					{/* LocaleScopeProvider isolates locale changes in nested forms */}
					<LocaleScopeProvider>
						{props.type === "collection" ? (
							<FormView
								collection={props.collection}
								id={props.itemId}
								defaultValues={props.defaultValues}
								config={undefined}
								allCollectionsConfig={undefined}
								navigate={navigate}
								basePath={basePath}
								onSuccess={handleSuccess}
								showMeta={false}
							/>
						) : (
							<GlobalFormView
								global={props.global}
								config={undefined}
								allGlobalsConfig={undefined}
								navigate={navigate}
								basePath={basePath}
								onSuccess={handleSuccess}
								showMeta={false}
							/>
						)}
					</LocaleScopeProvider>
				</div>
			</SheetContent>
		</Sheet>
	);
}
