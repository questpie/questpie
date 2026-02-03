/**
 * Global Form View - Default edit view component for globals
 *
 * Mirrors FormView for collections but adapted for singleton globals.
 * Renders global settings form with sections, tabs, sidebar, validation.
 */

import { Check, SpinnerGap } from "@phosphor-icons/react";
import { QuestpieClientError } from "questpie/client";
import * as React from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import type { GlobalBuilderState } from "../../builder/global/types";
import type { ComponentRegistry } from "../../builder/types/field-types";
import { LocaleSwitcher } from "../../components/locale-switcher";
import { Button } from "../../components/ui/button";
import { useGlobal, useGlobalUpdate } from "../../hooks/use-global";
import { useGlobalFields } from "../../hooks/use-global-fields";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import {
	selectAdmin,
	useAdminStore,
	useSafeContentLocales,
	useScopedLocale,
} from "../../runtime";
import { wrapLocalizedNestedValues } from "../../utils/wrap-localized";
import { AutoFormFields } from "../collection/auto-form-fields";

// ============================================================================
// Types
// ============================================================================

/**
 * Props for GlobalFormView component
 */
export interface GlobalFormViewProps {
	/**
	 * Global name
	 */
	global: string;

	/**
	 * Global configuration from admin builder
	 * Accepts GlobalBuilderState or any compatible config object
	 */
	config?: Partial<GlobalBuilderState> | Record<string, any>;

	/**
	 * Navigate function for routing
	 */
	navigate: (path: string) => void;

	/**
	 * Base path for admin routes (e.g., "/admin")
	 */
	basePath?: string;

	/**
	 * Component registry for custom field types
	 */
	registry?: ComponentRegistry;

	/**
	 * All globals config (for potential cross-references)
	 */
	allGlobalsConfig?: Record<
		string,
		Partial<GlobalBuilderState> | Record<string, any>
	>;

	/**
	 * Show metadata (updated dates)
	 * @default true
	 */
	showMeta?: boolean;

	/**
	 * Custom header actions (in addition to default Save button)
	 */
	headerActions?: React.ReactNode;

	/**
	 * Callback on successful save
	 */
	onSuccess?: (data: any) => void;

	/**
	 * Callback on error
	 */
	onError?: (error: Error) => void;
}

// ============================================================================
// Component
// ============================================================================

/**
 * GlobalFormView - Default form-based edit view for globals
 *
 * Features:
 * - Auto-generates form fields from global config
 * - Supports tabs, sections, and sidebar layout
 * - Keyboard shortcut (Cmd+S) to save
 * - Field-level validation errors from API
 * - Same layout and UX as collection FormView
 *
 * @example
 * ```tsx
 * // Used automatically via router when navigating to /admin/globals/:name
 * // Can also be used directly:
 * <GlobalFormView
 *   global="siteSettings"
 *   config={siteSettingsConfig}
 *   navigate={navigate}
 *   basePath="/admin"
 * />
 * ```
 */
export default function GlobalFormView({
	global: globalName,
	config,
	navigate,
	basePath = "/admin",
	registry,
	allGlobalsConfig,
	showMeta = true,
	headerActions,
	onSuccess,
	onError,
}: GlobalFormViewProps): React.ReactElement {
	const { t } = useTranslation();
	const resolveText = useResolveText();
	const admin = useAdminStore(selectAdmin);
	const { locale: contentLocale, setLocale: setContentLocale } =
		useScopedLocale();
	const contentLocales = useSafeContentLocales();
	const localeOptions = contentLocales?.locales ?? [];

	// Fetch global schema-driven fields (with fallback to config.fields)
	const { fields: schemaFields } = useGlobalFields(globalName);

	// Fetch global data
	const {
		data: globalData,
		isLoading,
		error: fetchError,
	} = useGlobal(globalName, { localeFallback: false });

	// Update mutation
	const updateMutation = useGlobalUpdate(globalName, {
		onSuccess: (data) => {
			toast.success(t("toast.saveSuccess"));
			onSuccess?.(data);
		},
		onError: (error) => {
			onError?.(error);
		},
	});

	const form = useForm({
		defaultValues: (globalData ?? {}) as any,
	});

	// Reset form when data loads
	React.useEffect(() => {
		if (globalData) {
			form.reset(globalData as any);
		}
	}, [form, globalData]);

	// Merge schema-driven fields with local config fields (local overrides win)
	const mergedFields = React.useMemo(
		() => ({ ...schemaFields, ...config?.fields }),
		[schemaFields, config?.fields],
	);

	const onSubmit = React.useCallback(
		async (data: any) => {
			// Transform nested localized values with $i18n wrappers
			const fieldsForTransform =
				Object.keys(mergedFields).length > 0 ? mergedFields : config?.fields;
			const transformedData = fieldsForTransform
				? wrapLocalizedNestedValues(data, {
						fields: fieldsForTransform,
						blocks: admin.state.blocks,
					})
				: data;

			try {
				const result = await updateMutation.mutateAsync({
					data: transformedData,
				});
				if (result) {
					form.reset(result as any);
				}
			} catch (error) {
				// Handle field-level validation errors from the API
				if (
					error instanceof QuestpieClientError &&
					error.fieldErrors &&
					error.fieldErrors.length > 0
				) {
					for (const fieldError of error.fieldErrors) {
						form.setError(fieldError.path as any, {
							type: "server",
							message: fieldError.message,
						});
					}
					toast.error(t("toast.validationFailed"), {
						description: t("toast.validationDescription"),
					});
					return;
				}

				// Handle generic errors
				const message =
					error instanceof Error ? error.message : t("error.unknown");
				toast.error(
					t("toast.settingsSaveFailed") || "Failed to save settings",
					{
						description: message,
					},
				);
			}
		},
		[updateMutation, form, t, config?.fields, admin.state.blocks, mergedFields],
	);

	// Keyboard shortcut: Cmd+S to save
	React.useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if ((e.metaKey || e.ctrlKey) && e.key === "s") {
				e.preventDefault();
				form.handleSubmit(onSubmit)();
			}
		};
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, [form, onSubmit]);

	const isSubmitting = updateMutation.isPending || form.formState.isSubmitting;

	// Format date helper
	const formatDate = (date: string | Date) => {
		return new Date(date).toLocaleDateString(undefined, {
			year: "numeric",
			month: "short",
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
		});
	};

	if (isLoading) {
		return (
			<div className="w-full">
				<div className="flex h-64 items-center justify-center text-muted-foreground">
					<SpinnerGap className="size-6 animate-spin" />
				</div>
			</div>
		);
	}

	if (fetchError) {
		return (
			<div className="w-full">
				<div className="rounded-lg border border-destructive/20 bg-destructive/5 p-6">
					<h2 className="text-lg font-semibold text-destructive">
						{t("toast.loadFailed")}
					</h2>
					<p className="mt-2 text-sm text-muted-foreground">
						{fetchError.message}
					</p>
				</div>
			</div>
		);
	}

	const title = resolveText(config?.label, globalName);
	const description = resolveText(config?.description);

	return (
		<div className="w-full">
			<FormProvider {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
					{/* Header - Title, Meta & Actions */}
					<div className="flex items-start justify-between">
						<div>
							<div className="flex items-center gap-3 flex-wrap">
								<h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
									{title}
								</h1>
								{localeOptions.length > 0 && (
									<LocaleSwitcher
										locales={localeOptions}
										value={contentLocale}
										onChange={setContentLocale}
									/>
								)}
							</div>
							{description && (
								<p className="mt-1 text-sm text-muted-foreground">
									{description}
								</p>
							)}
							{/* Metadata - inline below title */}
							{showMeta && globalData && (
								<p className="mt-1 text-xs text-muted-foreground font-mono flex items-center gap-2 flex-wrap">
									{(globalData as any).createdAt && (
										<>
											<span className="opacity-60">{t("form.created")} </span>
											<span>{formatDate((globalData as any).createdAt)}</span>
										</>
									)}
									{(globalData as any).updatedAt && (
										<>
											<span className="opacity-40">·</span>
											<span>
												<span className="opacity-60">{t("form.updated")} </span>
												{formatDate((globalData as any).updatedAt)}
											</span>
										</>
									)}
								</p>
							)}
						</div>

						<div className="flex items-center gap-2">
							{headerActions}
							<Button
								type="submit"
								disabled={isSubmitting || !form.formState.isDirty}
								className="gap-2"
							>
								{isSubmitting ? (
									<>
										<SpinnerGap className="size-4 animate-spin" />
										{t("common.loading")}
									</>
								) : (
									<>
										<Check size={16} />
										{t("common.save")}
									</>
								)}
							</Button>
						</div>
					</div>

					{/* Main Content - Form Fields */}
					<AutoFormFields
						collection={globalName as any}
						mode="global"
						config={config as any}
						registry={registry}
						allCollectionsConfig={allGlobalsConfig as any}
					/>
				</form>
			</FormProvider>
		</div>
	);
}
