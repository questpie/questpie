/**
 * VisualEditFormView
 *
 * Registry adapter for the Visual Edit Workspace. The workspace is
 * a rendering surface inside the existing `FormView` shell, not a
 * second form lifecycle. Delegating keeps save/create/update,
 * autosave, locks, locale switching, history, workflow transitions,
 * header actions, Cmd+S, and success/error callbacks on the same
 * path as the default collection form.
 */

"use client";

import type * as React from "react";

import type { CollectionBuilderState } from "../../builder/types/collection-types.js";
import type {
	ComponentRegistry,
	FormViewConfig,
} from "../../builder/types/field-types.js";
import FormView from "./form-view.js";

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

export default function VisualEditFormView(
	props: VisualEditFormViewProps,
): React.ReactElement {
	return <FormView {...props} />;
}
