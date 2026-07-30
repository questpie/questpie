/**
 * useAutosave — engine-agnostic debounced autosave for react-hook-form views.
 *
 * Extracted from the form view's `AutosaveManager`. The save pipeline
 * (`runAutosave`) is unchanged — it guards on dirty/submitting, submits via the
 * form, resets to the server result, and reports save state.
 *
 * The trigger is driven by `form.subscribe({ formState: { values: true } })`
 * (the same value-subscription `PreviewPatchBridge` uses) rather than DOM
 * `input`/`change` listeners. That makes it engine-agnostic: it catches native
 * input edits AND programmatic `field.onChange` emissions (e.g. the TipTap
 * rich-text field, whose contenteditable does not fire bubbling DOM events).
 *
 * Both the form view and the document view consume this hook so they share one
 * autosave code path.
 */

import * as React from "react";
import type { useForm } from "react-hook-form";
import { toast } from "sonner";

import { useTranslation } from "../i18n/hooks";
import {
	type OptimisticLockConfig,
	optimisticUpdateInput,
} from "../utils/optimistic-lock";

export interface UseAutosaveOptions {
	/** The react-hook-form instance to autosave. */
	form: ReturnType<typeof useForm>;
	/** Current item id. Autosave only runs in edit mode (id present). */
	id?: string;
	/** Whether autosave is enabled (from `config.autoSave.enabled`). */
	enabled: boolean;
	/** Debounce in ms before a save fires after the last change. */
	debounce: number;
	/** Mirror of the form's `isDirty` state (kept in a ref to avoid stale closures). */
	isDirtyRef: React.MutableRefObject<boolean>;
	/** Mirror of the form's `isSubmitting` state. */
	isSubmittingRef: React.MutableRefObject<boolean>;
	/** Update mutation used to persist the record. */
	updateMutation: {
		mutateAsync: (args: {
			id: string;
			data: unknown;
			expectedVersion?: number;
		}) => Promise<unknown>;
	};
	/** Introspected generated-CRUD locking contract. */
	optimisticLock?: OptimisticLockConfig;
	/** Optional: commit the saved snapshot to the live preview. */
	onPreviewCommit?: (data: unknown) => void;
	/** Optional: trigger a live-preview refresh after save. */
	onPreviewRefresh?: () => void;
	/** Called when a save starts/ends. */
	onSavingChange: (isSaving: boolean) => void;
	/** Called with the timestamp of a successful save. */
	onSaved: (savedAt: Date) => void;
}

/**
 * Wire debounced autosave onto a form. Returns the imperative `runAutosave`
 * callback so callers can also flush manually if needed.
 */
export function useAutosave({
	form,
	id,
	enabled,
	debounce,
	isDirtyRef,
	isSubmittingRef,
	updateMutation,
	optimisticLock,
	onPreviewCommit,
	onPreviewRefresh,
	onSavingChange,
	onSaved,
}: UseAutosaveOptions) {
	const { t } = useTranslation();
	const timerRef = React.useRef<NodeJS.Timeout | null>(null);

	const runAutosave = React.useCallback(async () => {
		if (!id || !isDirtyRef.current || isSubmittingRef.current) {
			return;
		}

		try {
			onSavingChange(true);

			await form.handleSubmit(
				async (data) => {
					const result = await updateMutation.mutateAsync(
						optimisticUpdateInput(
							id,
							data as Record<string, any>,
							optimisticLock,
						),
					);

					form.reset(result as any, { keepTouched: true });

					onPreviewCommit?.(result);
					onPreviewRefresh?.();

					onSaved(new Date());
					onSavingChange(false);
				},
				() => {
					onSavingChange(false);
				},
			)();
		} catch (error) {
			onSavingChange(false);
			console.error("Autosave failed:", error);
			toast.error(t("error.autosaveFailed"), {
				description: error instanceof Error ? error.message : undefined,
			});
		}
	}, [
		form,
		id,
		isDirtyRef,
		isSubmittingRef,
		onSaved,
		onSavingChange,
		onPreviewCommit,
		onPreviewRefresh,
		t,
		updateMutation,
		optimisticLock,
	]);

	React.useEffect(() => {
		if (timerRef.current) {
			clearTimeout(timerRef.current);
		}

		if (!enabled || !id) {
			return;
		}

		const scheduleAutosave = () => {
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}

			timerRef.current = setTimeout(() => {
				void runAutosave();
			}, debounce);
		};

		// Value-subscription trigger: fires for every form value change, including
		// programmatic `field.onChange` (rich-text/TipTap) that DOM listeners miss.
		const unsubscribe = form.subscribe({
			formState: { values: true },
			callback: scheduleAutosave,
		});

		return () => {
			unsubscribe();
			if (timerRef.current) {
				clearTimeout(timerRef.current);
			}
		};
	}, [debounce, enabled, form, id, runAutosave]);

	return runAutosave;
}
