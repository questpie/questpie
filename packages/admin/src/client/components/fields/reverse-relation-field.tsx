/**
 * ReverseRelationField Component
 *
 * Displays items from another collection that reference the current item.
 * Shows the "other side" of a relation with optional assignment controls.
 *
 * Supports two modes:
 * - linkToDetail: Click navigates to the item's detail page (default)
 * - openInSheet: Click opens item in a side sheet for quick editing
 *
 * @example
 * ```tsx
 * // On service detail - show all barbers that offer this service
 * <ReverseRelationField
 *   name="offeredBy"
 *   label="Offered by"
 *   sourceCollection="barbers"
 *   sourceField="services"
 *   display="chips"
 *   openInSheet // Edit barbers in a side sheet
 * />
 * ```
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { useFormContext, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { useAdminConfig } from "../../hooks/use-admin-config";
import { useAdminRoutes } from "../../hooks/use-admin-routes";
import {
	useCollectionList,
	useCollectionUpdate,
} from "../../hooks/use-collection";
import { useQuestpieQueryOptions } from "../../hooks/use-questpie-query-options";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { resolveIconElement } from "../component-renderer";
import { SelectSingle } from "../primitives/select-single";
import type { SelectOption } from "../primitives/types";
import { ResourceSheet } from "../sheets/resource-sheet";
import { Button } from "../ui/button";
import type { BaseFieldProps, ReverseRelationFieldConfig } from "./field-types";
import { getAutoColumns } from "./field-utils";
import { LocaleBadge } from "./locale-badge";
import { type RelationDisplayMode, RelationItemsDisplay } from "./relation";

// ============================================================================
// Types
// ============================================================================

export interface ReverseRelationFieldProps
	extends BaseFieldProps,
		ReverseRelationFieldConfig {}

// ============================================================================
// Create Button (extracted to module scope for stable identity)
// ============================================================================

function CreateButton({
	variant = "text",
	allowCreate,
	currentId,
	t,
	actionLabel,
	resolvedCreateLabel,
	openInSheet,
	handleCreateClick,
	disabled,
	createUrl,
}: {
	variant?: "text" | "icon";
	allowCreate: boolean;
	currentId: string | undefined;
	t: (key: string, params?: Record<string, unknown>) => string;
	actionLabel: string;
	resolvedCreateLabel: string | undefined;
	openInSheet: boolean;
	handleCreateClick: () => void;
	disabled?: boolean;
	createUrl: string | null | undefined;
}) {
	if (!allowCreate || !currentId) return null;

	const defaultLabel = t("relation.addItem", {
		name: actionLabel,
	});
	const buttonLabel = resolvedCreateLabel || defaultLabel;
	const buttonIcon = <Icon icon="ph:plus" className="size-4" />;
	const buttonContent =
		variant === "icon" ? null : (
			<>
				<Icon icon="ph:plus" className="size-4 mr-1" />
				{buttonLabel}
			</>
		);

	if (openInSheet) {
		return (
			<Button
				type="button"
				variant="outline"
				size={variant === "icon" ? "icon" : "sm"}
				onClick={handleCreateClick}
				disabled={disabled}
				title={buttonLabel}
				aria-label={buttonLabel}
			>
				{variant === "icon" ? buttonIcon : buttonContent}
			</Button>
		);
	}

	if (createUrl) {
		return (
			<Button
				variant="outline"
				size={variant === "icon" ? "icon" : "sm"}
				nativeButton={false}
				disabled={disabled}
				title={buttonLabel}
				aria-label={buttonLabel}
				render={
					// biome-ignore lint/a11y/useAnchorContent: base-ui renders children into the anchor
					<a href={createUrl} aria-label={buttonLabel} />
				}
			>
				{variant === "icon" ? buttonIcon : buttonContent}
			</Button>
		);
	}

	return null;
}

// ============================================================================
// Main Component
// ============================================================================

export function ReverseRelationField({
	name,
	label,
	description,
	required,
	disabled,
	localized,
	locale,
	sourceCollection,
	sourceField,
	display = "list",
	columns,
	fields,
	gridColumns,
	limit = 10,
	emptyMessage,
	linkToDetail = true,
	allowCreate = false,
	allowAssign: allowAssignProp,
	createLabel,
	openInSheet = false,
}: ReverseRelationFieldProps) {
	const { t } = useTranslation();
	const resolveText = useResolveText();
	const resolvedCreateLabel = createLabel
		? resolveText(createLabel)
		: undefined;
	const resolvedEmptyMessage = emptyMessage
		? resolveText(emptyMessage)
		: t("relation.noRelated");
	const parentForm = useFormContext();
	const { collectionCreateUrl, toCollectionEdit, routes } = useAdminRoutes();

	// Sheet state
	const [isSheetOpen, setIsSheetOpen] = React.useState(false);
	const [editingItemId, setEditingItemId] = React.useState<
		string | undefined
	>();

	// Get admin config from server
	const { data: serverConfig } = useAdminConfig();
	const {
		queryOpts,
		queryClient,
		locale: contentLocale,
		client,
	} = useQuestpieQueryOptions();
	const sourceConfig = serverConfig?.collections?.[sourceCollection];
	const collectionIconRef = (sourceConfig as any)?.icon;
	const sourceFieldConfig = (sourceConfig as any)?.fields?.[sourceField];
	const sourceFieldOptions = (sourceFieldConfig as any)?.["~options"] ?? {};
	const sourceRelationName = sourceFieldOptions?.relationName ?? sourceField;
	const sourceRelationType = sourceFieldOptions?.type;
	const isRelationField = sourceFieldConfig?.name === "relation";
	const isMultipleRelation = sourceRelationType === "multiple";
	const isRequiredRelationField = sourceFieldOptions?.required === true;
	const resolvedSourceLabel = resolveText(
		(sourceConfig as any)?.label ?? sourceCollection,
	);
	const actionLabel = resolvedSourceLabel.replace(/s$/, "");

	// Watch the current item's ID
	const currentId = useWatch({
		control: parentForm.control,
		name: "id",
	});
	const allowAssign = allowAssignProp ?? allowCreate;
	const canAssign = allowAssign && !disabled;
	const canRemove =
		canAssign && (isMultipleRelation || !isRequiredRelationField);
	const updateMutation = useCollectionUpdate(sourceCollection as any);

	// Build create URL with prefill params (for link mode)
	// For multiple relations (M2M), encode as JSON array; for single, use plain string
	const createUrl = React.useMemo(() => {
		if (!allowCreate || !currentId || !sourceCollection || !sourceField) {
			return null;
		}
		const baseUrl = collectionCreateUrl(sourceCollection as any);
		const prefillValue = isMultipleRelation
			? JSON.stringify([currentId])
			: currentId;
		return routes.withQuery(baseUrl, {
			[`prefill.${sourceField}`]: prefillValue,
		});
	}, [
		allowCreate,
		currentId,
		sourceCollection,
		sourceField,
		collectionCreateUrl,
		routes,
		isMultipleRelation,
	]);

	// Build filter to find items that reference this item
	const filter = React.useMemo(() => {
		if (!currentId) return undefined;
		if (!isRelationField) {
			return {
				[sourceField]: currentId,
			};
		}
		if (isMultipleRelation) {
			return {
				[sourceRelationName]: { some: { id: currentId } },
			};
		}
		return {
			[sourceRelationName]: { is: { id: currentId } },
		};
	}, [
		currentId,
		isRelationField,
		isMultipleRelation,
		sourceRelationName,
		sourceField,
	]);

	// Fetch related items
	const { data, isLoading, refetch } = useCollectionList(
		sourceCollection,
		{
			where: filter,
			limit,
		},
		{
			enabled: !!currentId && !!sourceCollection && !!sourceField,
		},
	);

	const items = data?.docs ?? [];
	const totalCount = data?.totalDocs ?? items.length;
	const selectedIds = React.useMemo(
		() => items.map((item: any) => item.id),
		[items],
	);
	const assignLabel = t("relation.addItem", { name: actionLabel });
	const noResultsLabel = t("relation.noResults", {
		name: actionLabel,
	});
	const showAssignmentControls = canAssign && !!currentId;
	const showCreateControls = allowCreate && !!currentId;
	const showCreateInHeader = !showAssignmentControls;
	const showActionRow =
		showAssignmentControls || (showCreateControls && !showCreateInHeader);
	const isMutationPending = updateMutation.isPending;

	const loadOptions = React.useCallback(
		async (search: string): Promise<SelectOption<string>[]> => {
			if (!client) return [];

			try {
				const options: any = {
					limit: 50,
				};

				if (search) {
					options.search = search;
				}

				const response = await (client as any).collections[
					sourceCollection
				].find(options);
				const docs = response?.docs ?? [];

				return docs
					.filter((doc: any) => !selectedIds.includes(doc.id))
					.map((item: any) => ({
						value: item.id,
						label: item._title || item.id || "",
						icon: resolveIconElement(collectionIconRef, {
							className: "size-3.5 text-muted-foreground",
						}),
					}));
			} catch (loadError) {
				const message =
					loadError instanceof Error
						? loadError.message
						: t("toast.loadFailed");
				toast.error(message);
				return [];
			}
		},
		[client, sourceCollection, selectedIds, collectionIconRef, t],
	);

	const resolveManyRelationIds = React.useCallback(
		async (item: any): Promise<string[]> => {
			const directValue = item?.[sourceRelationName] ?? item?.[sourceField];
			if (Array.isArray(directValue)) {
				return directValue
					.map((entry: any) => (typeof entry === "string" ? entry : entry?.id))
					.filter(Boolean);
			}
			if (!client) return [];
			const response = await (client as any).collections[
				sourceCollection
			].findOne({
				where: { id: item.id },
				with: { [sourceRelationName]: true },
			});
			const relatedItems = response?.[sourceRelationName];
			if (!Array.isArray(relatedItems)) return [];
			return relatedItems
				.map((entry: any) => (typeof entry === "string" ? entry : entry?.id))
				.filter(Boolean);
		},
		[client, sourceCollection, sourceRelationName, sourceField],
	);

	const handleAssign = React.useCallback(
		async (value: string | null) => {
			if (!value || !currentId || !canAssign || isMutationPending) return;
			try {
				if (isMultipleRelation) {
					await updateMutation.mutateAsync({
						id: value,
						data: {
							[sourceField]: {
								connect: { id: currentId },
							},
						},
					});
				} else {
					await updateMutation.mutateAsync({
						id: value,
						data: { [sourceField]: currentId },
					});
				}
				toast.success(t("toast.actionSuccess"));
				await refetch();
				queryClient.invalidateQueries({
					queryKey: queryOpts.key(["collections", sourceCollection, "find"]),
				});
				queryClient.invalidateQueries({
					queryKey: queryOpts.key(["collections", sourceCollection, "findOne"]),
				});
			} catch (assignError) {
				const message =
					assignError instanceof Error
						? assignError.message
						: t("toast.actionFailed");
				toast.error(message);
			}
		},
		[
			canAssign,
			currentId,
			isMutationPending,
			isMultipleRelation,
			queryClient,
			queryOpts,
			refetch,
			sourceCollection,
			sourceField,
			t,
			updateMutation,
		],
	);

	const handleRemove = React.useCallback(
		async (item: any) => {
			if (!currentId || !canRemove || isMutationPending) return;
			try {
				if (isMultipleRelation) {
					const existingIds = await resolveManyRelationIds(item);
					const nextIds = existingIds.filter((id) => id !== currentId);
					if (nextIds.length === existingIds.length) return;
					await updateMutation.mutateAsync({
						id: item.id,
						data: {
							[sourceField]: { set: nextIds },
						},
					});
				} else {
					await updateMutation.mutateAsync({
						id: item.id,
						data: { [sourceField]: null },
					});
				}
				toast.success(t("toast.actionSuccess"));
				await refetch();
				queryClient.invalidateQueries({
					queryKey: queryOpts.key(["collections", sourceCollection, "find"]),
				});
				queryClient.invalidateQueries({
					queryKey: queryOpts.key(["collections", sourceCollection, "findOne"]),
				});
			} catch (removeError) {
				const message =
					removeError instanceof Error
						? removeError.message
						: t("toast.actionFailed");
				toast.error(message);
			}
		},
		[
			canRemove,
			currentId,
			isMutationPending,
			isMultipleRelation,
			queryClient,
			queryOpts,
			refetch,
			sourceCollection,
			resolveManyRelationIds,
			sourceField,
			t,
			updateMutation,
		],
	);

	// Compute display columns for table mode
	// NOTE: This must be called before any early returns to maintain hook order
	const displayColumns = React.useMemo(() => {
		if (columns && columns.length > 0) return columns;
		if (display === "table" && sourceConfig) {
			return getAutoColumns(sourceConfig);
		}
		return ["_title"];
	}, [columns, display, sourceConfig]);

	// Handle item click (for sheet mode)
	const handleItemClick = React.useCallback(
		(item: any) => {
			if (openInSheet) {
				setEditingItemId(item.id);
				setIsSheetOpen(true);
				return;
			}
			if (linkToDetail) {
				toCollectionEdit(sourceCollection as any, item.id);
			}
		},
		[openInSheet, linkToDetail, sourceCollection, toCollectionEdit],
	);
	const displayActions = React.useMemo(() => {
		const actions: {
			onEdit?: (item: any) => void;
			onRemove?: (item: any) => void;
		} = {};
		if (openInSheet || (canAssign && linkToDetail)) {
			actions.onEdit = handleItemClick;
		}
		if (canRemove) {
			actions.onRemove = handleRemove;
		}
		return Object.keys(actions).length > 0 ? actions : undefined;
	}, [
		canAssign,
		canRemove,
		handleItemClick,
		handleRemove,
		linkToDetail,
		openInSheet,
	]);
	const isEditable = canAssign;
	const showLinkToDetail = linkToDetail && !openInSheet && !canAssign;

	// Handle create button click
	const handleCreateClick = React.useCallback(() => {
		if (openInSheet) {
			setEditingItemId(undefined);
			setIsSheetOpen(true);
		}
		// If not openInSheet, the link will handle navigation
	}, [openInSheet]);

	// Handle save from ResourceSheet
	const handleSheetSave = React.useCallback(async () => {
		await refetch();
		queryClient.invalidateQueries({
			queryKey: queryOpts.key(["collections", sourceCollection, "find"]),
		});
		queryClient.invalidateQueries({
			queryKey: queryOpts.key(["collections", sourceCollection, "findOne"]),
		});
	}, [queryClient, queryOpts, refetch, sourceCollection]);

	// Default values for create mode (prefill relation field)
	// For multiple relations (M2M), wrap in array; for single relations, use string
	const sheetDefaultValues = React.useMemo(() => {
		if (editingItemId) return undefined;
		const prefillValue = isMultipleRelation ? [currentId] : currentId;
		return { [sourceField]: prefillValue };
	}, [editingItemId, sourceField, currentId, isMultipleRelation]);

	// No current ID (new item)
	if (!currentId) {
		return (
			<div className="space-y-2">
				{label && (
					<div className="flex items-center gap-2">
						<span className="text-sm font-medium">{resolveText(label)}</span>
						{localized && <LocaleBadge locale={locale || "i18n"} />}
					</div>
				)}
				<p className="text-sm text-muted-foreground">
					{t("relation.saveFirst")}
				</p>
			</div>
		);
	}

	const createButtonProps = {
		allowCreate,
		currentId,
		t,
		actionLabel,
		resolvedCreateLabel,
		openInSheet,
		handleCreateClick,
		disabled,
		createUrl,
	};

	return (
		<div className="space-y-2">
			{label && (
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<span className="text-sm font-medium">{resolveText(label)}</span>
						{localized && <LocaleBadge locale={locale || "i18n"} />}
					</div>
					<div className="flex items-center gap-3">
						{totalCount > items.length && (
							<span className="text-xs text-muted-foreground">
								Showing {items.length} of {totalCount}
							</span>
						)}
						{showCreateInHeader && <CreateButton variant="text" {...createButtonProps} />}
					</div>
				</div>
			)}
			{description && (
				<p className="text-sm text-muted-foreground">
					{resolveText(description)}
				</p>
			)}

			{showActionRow && (
				<div className="flex gap-2">
					{showAssignmentControls && (
						<div className="flex-1">
							<SelectSingle
								value={null}
								onChange={handleAssign}
								loadOptions={loadOptions}
								queryKey={(search) =>
									queryOpts.key([
										"collections",
										sourceCollection,
										"find",
										{
											limit: 50,
											search,
											selectedIds,
										},
									])
								}
								prefetchOnMount
								placeholder={`${assignLabel}...`}
								disabled={disabled || isMutationPending}
								clearable={false}
								emptyMessage={noResultsLabel}
								drawerTitle={assignLabel}
							/>
						</div>
					)}
					{showCreateControls && !showCreateInHeader && (
						<CreateButton variant="icon" {...createButtonProps} />
					)}
				</div>
			)}

			{/* Items Display using shared component */}
			<RelationItemsDisplay
				display={display as RelationDisplayMode}
				items={items}
				collection={sourceCollection}
				collectionIcon={collectionIconRef}
				editable={isEditable}
				columns={displayColumns}
				fields={fields}
				gridColumns={gridColumns}
				linkToDetail={showLinkToDetail}
				emptyMessage={resolvedEmptyMessage}
				actions={displayActions}
				collectionConfig={sourceConfig as any}
				isLoading={isLoading}
				loadingCount={limit}
			/>

			{/* Create button in empty state (when no label header) */}
			{items.length === 0 &&
				!isLoading &&
				!label &&
				allowCreate &&
				!showAssignmentControls && (
					<div className="mt-3 text-center">
						<CreateButton variant="text" {...createButtonProps} />
					</div>
				)}

			{/* Edit Sheet - using reusable ResourceSheet component */}
			{openInSheet && (
				<ResourceSheet
					type="collection"
					collection={sourceCollection}
					itemId={editingItemId}
					open={isSheetOpen}
					onOpenChange={setIsSheetOpen}
					onSave={handleSheetSave}
					defaultValues={sheetDefaultValues}
				/>
			)}
		</div>
	);
}
