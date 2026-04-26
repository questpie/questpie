/**
 * VisualEditFormView
 *
 * View-registry adapter that surfaces the Visual Edit Workspace
 * (`VisualEditFormHost`) under the same `kind: "form"` contract
 * the legacy `FormView` uses. Once registered, projects can opt
 * into the workspace per-collection with:
 *
 * ```ts
 * c.collection("pages").admin().form({ view: "visual-edit" })
 * ```
 *
 * The component intentionally mirrors `FormView`'s prop shape so
 * the runtime resolver can swap one for the other based purely on
 * the `view` key.
 *
 * Phase 8 wires the public surface; richer behaviours (autosave,
 * locale dialog, action toolbar) are still owned by `FormView`
 * and will migrate over in follow-up phases.
 */

"use client";

import { useQuery } from "@tanstack/react-query";
import * as React from "react";

import type { CollectionBuilderState } from "../../builder/types/collection-types.js";
import type {
	ComponentRegistry,
	FormViewConfig,
} from "../../builder/types/field-types.js";
import { useCollectionItem } from "../../hooks/use-collection.js";
import { useCollectionFields } from "../../hooks/use-collection-fields.js";
import { useScopedLocale } from "../../runtime/index.js";
import { selectClient, useAdminStore } from "../../runtime/provider.js";
import { VisualEditFormHost } from "../../components/visual-edit/visual-edit-form-host.js";

// ============================================================================
// Types — must mirror FormViewProps shape so the registry can swap
// either component in.
// ============================================================================

interface VisualEditFormViewProps {
	collection: string;
	id?: string;
	config?: Partial<CollectionBuilderState> | Record<string, any>;
	viewConfig?: FormViewConfig;
	navigate: (path: string) => void;
	basePath?: string;
	defaultValues?: Record<string, any>;
	registry?: ComponentRegistry;
	allCollectionsConfig?: Record<
		string,
		Partial<CollectionBuilderState> | Record<string, any>
	>;
	showMeta?: boolean;
	headerActions?: React.ReactNode;
	onSuccess?: (data: any) => void;
	onError?: (error: Error) => void;
}

// ============================================================================
// Component
// ============================================================================

export default function VisualEditFormView({
	collection,
	id,
	config,
	viewConfig,
	defaultValues,
	registry,
	allCollectionsConfig,
}: VisualEditFormViewProps): React.ReactElement {
	const isEditMode = !!id;
	const { schema } = useCollectionFields(collection, {
		fallbackFields: (config as any)?.fields,
	});
	const previewSchema = schema?.admin?.preview;
	const hasPreview =
		!!previewSchema?.hasUrlBuilder && previewSchema?.enabled !== false;

	const { data: item } = useCollectionItem(
		collection as any,
		id ?? "",
		{ localeFallback: false },
		{ enabled: isEditMode },
	);

	const client = useAdminStore(selectClient);
	const { locale } = useScopedLocale();

	const previewQuery = useQuery({
		queryKey: [
			"questpie",
			"preview-url",
			collection,
			id ?? "",
			locale ?? "",
		],
		queryFn: async () => {
			if (!client || !id || !hasPreview) return null;
			return await (client as any).routes.getPreviewUrl({
				collection,
				record: item,
				locale,
			});
		},
		enabled: !!client && !!id && hasPreview && !!item,
		staleTime: 30_000,
	});

	const previewUrl: string | null =
		typeof previewQuery.data === "string"
			? previewQuery.data
			: previewQuery.data?.url ?? null;

	return (
		<VisualEditFormHost
			collection={collection}
			id={id}
			config={config}
			viewConfig={viewConfig}
			defaultValues={defaultValues}
			registry={registry}
			allCollectionsConfig={allCollectionsConfig}
			previewUrl={previewUrl}
			defaultInspectorSize={previewSchema?.defaultSize}
			minInspectorSize={previewSchema?.minSize}
			className="h-full"
		/>
	);
}
