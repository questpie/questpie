/**
 * Global Form View - Default edit view component for globals
 *
 * Mirrors FormView for collections but adapted for singleton globals.
 * Renders global settings form with sections, tabs, sidebar, validation.
 */

import { Icon } from "@iconify/react";
import { QuestpieClientError } from "questpie/client";
import * as React from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import type {
	ComponentRegistry,
	FormViewConfig,
} from "../../builder/types/field-types";
import type { GlobalBuilderState } from "../../builder/types/global-types";
import { LocaleSwitcher } from "../../components/locale-switcher";
import { Button } from "../../components/ui/button";
import { useGlobal, useGlobalUpdate } from "../../hooks";
import { useGlobalFields } from "../../hooks/use-global-fields";
import { useReactiveFields } from "../../hooks/use-reactive-fields";
import { useGlobalServerValidation } from "../../hooks/use-server-validation";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { useSafeContentLocales, useScopedLocale } from "../../runtime";
import { AutoFormFields } from "../collection/auto-form-fields";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract reactive configs from global schema fields.
 * Used to determine which fields have server-side reactive behaviors.
 */
function extractReactiveConfigs(schema: any): Record<string, any> {
	if (!schema?.fields) return {};

	const configs: Record<string, any> = {};

	for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
		if ((fieldDef as any).reactive) {
			configs[fieldName] = (fieldDef as any).reactive;
		}
	}

	return configs;
}

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
	 * View-specific configuration from registry/schema
	 */
	viewConfig?: FormViewConfig;

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
 */
export default function GlobalFormView({
	global: globalName,
	config,
	viewConfig,
	registry,
	showMeta = true,
	headerActions,
	onSuccess,
	onError,
}: GlobalFormViewProps) {
	const { t } = useTranslation();
	const resolveText = useResolveText();

	const { data: globalData, isLoading: dataLoading } = useGlobal(globalName);
	const { fields: schemaFields } = useGlobalFields(globalName);

	const { locale: contentLocale, setLocale: setContentLocale } =
		useScopedLocale();
	const contentLocales = useSafeContentLocales();
	const localeOptions = contentLocales?.locales ?? [];

	const updateMutation = useGlobalUpdate(globalName, {
		onSuccess: (data) => {
			toast.success(t("toast.saveSuccess"));
			onSuccess?.(data);
		},
		onError: (error) => {
			onError?.(error);
		},
	});

	// Get validation resolver - uses server JSON Schema for validation
	const { resolver } = useGlobalServerValidation(globalName);

	const form = useForm({
		defaultValues: (globalData ?? {}) as any,
		resolver,
	});

	// Reset form when data loads
	React.useEffect(() => {
		if (globalData) {
			form.reset(globalData as any);
		}
	}, [form, globalData]);

	// Extract reactive configs from schema for server-side reactive handlers
	const reactiveConfigs = React.useMemo(
		() => extractReactiveConfigs(schemaFields),
		[schemaFields],
	);

	// Use reactive fields hook for server-side compute/hidden/readOnly/disabled
	useReactiveFields({
		collection: globalName,
		mode: "global",
		reactiveConfigs,
		enabled: !dataLoading && Object.keys(reactiveConfigs).length > 0,
		debounce: 300,
	});

	const resolvedConfig = React.useMemo(() => {
		if (!viewConfig) return config;

		return {
			...(config ?? {}),
			form: viewConfig,
		};
	}, [config, viewConfig]);

	const onSubmit = React.useCallback(
		async (data: any) => {
			try {
				const result = await updateMutation.mutateAsync({
					data,
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
		[updateMutation, form, t],
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

	if (dataLoading) {
		return (
			<div className="flex h-64 items-center justify-center text-muted-foreground">
				<Icon icon="ph:spinner-gap" className="size-6 animate-spin" />
			</div>
		);
	}

	const globalLabel = resolveText(
		(resolvedConfig as any)?.label ?? schemaFields?._globalLabel,
		globalName,
	);

	return (
		<FormProvider {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)} className="w-full space-y-4">
				{/* Header - Title & Actions */}
				<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div className="min-w-0 flex-1">
						<div className="flex items-center gap-3">
							<h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
								{globalLabel}
							</h1>
							{localeOptions.length > 0 && (
								<LocaleSwitcher
									locales={localeOptions}
									value={contentLocale}
									onChange={setContentLocale}
								/>
							)}
						</div>
						{showMeta && globalData?.updatedAt && (
							<p className="mt-1 text-xs text-muted-foreground">
								{t("form.lastUpdated")}: {formatDate(globalData.updatedAt)}
							</p>
						)}
					</div>

					<div className="flex items-center gap-2 shrink-0">
						{headerActions}
						<Button type="submit" disabled={isSubmitting} className="gap-2">
							{isSubmitting ? (
								<>
									<Icon icon="ph:spinner-gap" className="size-4 animate-spin" />
									{t("common.loading")}
								</>
							) : (
								<>
									<Icon icon="ph:check" width={16} height={16} />
									{t("common.save")}
								</>
							)}
						</Button>
					</div>
				</div>

				{/* Main Content - Form Fields */}
				<AutoFormFields
					collection={globalName}
					mode="global"
					config={resolvedConfig}
					registry={registry}
				/>
			</form>
		</FormProvider>
	);
}
