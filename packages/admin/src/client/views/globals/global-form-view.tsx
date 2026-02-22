/**
 * Global Form View - Default edit view component for globals
 *
 * Mirrors FormView for collections but adapted for singleton globals.
 * Renders global settings form with sections, tabs, sidebar, validation.
 */

import { Icon } from "@iconify/react";
import type { GlobalSchema } from "questpie";
import { QuestpieClientError } from "questpie/client";
import * as React from "react";
import { FormProvider, useForm } from "react-hook-form";
import { toast } from "sonner";
import type {
	ComponentRegistry,
	FormViewConfig,
} from "../../builder/types/field-types";
import type { GlobalBuilderState } from "../../builder/types/global-types";
import { ConfirmationDialog } from "../../components/actions/confirmation-dialog";
import { HistorySidebar } from "../../components/history-sidebar";
import { LocaleSwitcher } from "../../components/locale-switcher";
import { DateTimeInput } from "../../components/primitives/date-input";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Checkbox } from "../../components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "../../components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { Label } from "../../components/ui/label";
import {
	useGlobal,
	useGlobalRevertVersion,
	useGlobalUpdate,
	useGlobalVersions,
	useSidebarSearchParam,
} from "../../hooks";
import { useGlobalAuditHistory } from "../../hooks/use-audit-history";
import { useGlobalFields } from "../../hooks/use-global-fields";
import { useReactiveFields } from "../../hooks/use-reactive-fields";
import { useGlobalServerValidation } from "../../hooks/use-server-validation";
import { useTransitionStage } from "../../hooks/use-transition-stage";
import { useResolveText, useTranslation } from "../../i18n/hooks";
import { useSafeContentLocales, useScopedLocale } from "../../runtime";
import { AutoFormFields } from "../collection/auto-form-fields";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract reactive configs from global schema.
 * Used to determine which fields have server-side reactive behaviors.
 */
function extractReactiveConfigs(
	schema: GlobalSchema | undefined,
): Record<string, any> {
	if (!schema?.fields) return {};

	const configs: Record<string, any> = {};

	for (const [fieldName, fieldDef] of Object.entries(schema.fields)) {
		if (fieldDef.reactive) {
			configs[fieldName] = fieldDef.reactive;
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
interface GlobalFormViewProps {
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
	const { fields: schemaFields, schema: globalSchema } =
		useGlobalFields(globalName);

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
	const revertVersionMutation = useGlobalRevertVersion(globalName);

	const [isHistoryOpen, setIsHistoryOpen] = useSidebarSearchParam("history", {
		legacyKey: "history",
	});
	const [pendingRevertVersion, setPendingRevertVersion] =
		React.useState<any>(null);

	const { data: versionsData, isLoading: versionsLoading } = useGlobalVersions(
		globalName,
		{ id: globalData?.id, limit: 50 },
		{ enabled: isHistoryOpen && !!globalSchema?.options?.versioning },
	);

	const { data: auditData, isLoading: auditLoading } = useGlobalAuditHistory(
		globalName,
		{ limit: 50 },
		{ enabled: isHistoryOpen },
	);

	// ========================================================================
	// Workflow — stage badge, transition dropdown, scheduling
	// ========================================================================

	const workflowConfig = globalSchema?.options?.workflow as
		| {
				enabled: boolean;
				initialStage: string;
				stages: Array<{
					name: string;
					label?: string;
					description?: string;
					transitions?: string[];
				}>;
		  }
		| undefined;
	const workflowEnabled = !!workflowConfig?.enabled;

	/** Lightweight versions query (limit: 1) to read the current stage. */
	const { data: latestVersionData } = useGlobalVersions(
		globalName,
		{ id: globalData?.id, limit: 1 },
		{ enabled: workflowEnabled && !!globalData?.id },
	);

	const currentStage =
		(latestVersionData as any)?.[0]?.versionStage ??
		workflowConfig?.initialStage ??
		null;

	const currentStageConfig = React.useMemo(
		() => workflowConfig?.stages?.find((s) => s.name === currentStage) ?? null,
		[workflowConfig?.stages, currentStage],
	);

	const currentStageLabel = currentStageConfig?.label ?? currentStage ?? "";

	/** Allowed transitions from the current stage. */
	const allowedTransitions = React.useMemo(() => {
		if (!workflowConfig?.stages || !currentStage) return [];
		const stageNames = currentStageConfig?.transitions;
		if (stageNames && stageNames.length > 0) {
			return stageNames
				.map((name) => workflowConfig.stages.find((s) => s.name === name))
				.filter(Boolean) as typeof workflowConfig.stages;
		}
		return workflowConfig.stages.filter((s) => s.name !== currentStage);
	}, [workflowConfig, currentStage, currentStageConfig]);

	const transitionMutation = useTransitionStage(globalName, {
		mode: "global",
	});

	const [transitionTarget, setTransitionTarget] = React.useState<{
		name: string;
		label?: string;
	} | null>(null);
	const [transitionSchedule, setTransitionSchedule] = React.useState(false);
	const [transitionScheduledAt, setTransitionScheduledAt] =
		React.useState<Date | null>(null);

	// Get validation resolver - uses server JSON Schema for validation
	const { resolver } = useGlobalServerValidation(globalName);

	const form = useForm({
		defaultValues: (globalData ?? {}) as any,
		resolver,
	});

	/** Execute the confirmed workflow transition (immediate or scheduled). */
	const confirmTransition = React.useCallback(() => {
		if (!transitionTarget) return;

		const params: { stage: string; scheduledAt?: Date } = {
			stage: transitionTarget.name,
		};
		if (transitionSchedule) {
			if (transitionScheduledAt) {
				params.scheduledAt = transitionScheduledAt;
			}
		}

		const stageLabel = transitionTarget.label
			? transitionTarget.label
			: transitionTarget.name;

		const resetTransitionState = () => {
			setTransitionTarget(null);
			setTransitionSchedule(false);
			setTransitionScheduledAt(null);
		};

		transitionMutation.mutateAsync(params).then(
			(result) => {
				if (result) {
					if (typeof result === "object") {
						form.reset(result as any);
					}
				}

				if (transitionSchedule) {
					if (transitionScheduledAt) {
						toast.success(
							t("workflow.scheduledSuccess", {
								stage: stageLabel,
								date: transitionScheduledAt.toLocaleString(),
							}),
						);
					} else {
						toast.success(
							t("workflow.transitionSuccess", {
								stage: stageLabel,
							}),
						);
					}
				} else {
					toast.success(
						t("workflow.transitionSuccess", {
							stage: stageLabel,
						}),
					);
				}
				resetTransitionState();
			},
			(err) => {
				let description: string;
				if (err instanceof Error) {
					description = err.message;
				} else {
					description = t("error.unknown");
				}
				toast.error(t("workflow.transitionFailed"), {
					description,
				});
				resetTransitionState();
			},
		);
	}, [
		transitionTarget,
		transitionSchedule,
		transitionScheduledAt,
		transitionMutation,
		form,
		t,
	]);

	// Reset form when data loads
	React.useEffect(() => {
		if (globalData) {
			form.reset(globalData as any);
		}
	}, [form, globalData]);

	// Extract reactive configs from schema for server-side reactive handlers
	const reactiveConfigs = React.useMemo(
		() => extractReactiveConfigs(globalSchema),
		[globalSchema],
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

	const confirmRevertVersion = React.useCallback(async () => {
		if (!pendingRevertVersion) return;

		const payload: { id?: string; version?: number; versionId?: string } = {};
		if (typeof globalData?.id === "string") {
			payload.id = globalData.id;
		}
		if (typeof pendingRevertVersion.versionId === "string") {
			payload.versionId = pendingRevertVersion.versionId;
		} else if (typeof pendingRevertVersion.versionNumber === "number") {
			payload.version = pendingRevertVersion.versionNumber;
		}

		const result = await revertVersionMutation.mutateAsync(payload);
		form.reset(result as any);
		toast.success(t("version.revertSuccess"));
		setPendingRevertVersion(null);
	}, [pendingRevertVersion, globalData, revertVersionMutation, form, t]);

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
						<div className="flex items-center gap-3 flex-wrap">
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

							{/* Workflow stage badge */}
							{workflowEnabled && currentStage && (
								<Badge variant="outline" className="gap-1.5">
									<Icon icon="ph:git-branch" className="size-3" />
									{currentStageLabel}
								</Badge>
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

						{/* Workflow transition dropdown */}
						{workflowEnabled && allowedTransitions.length > 0 && (
							<DropdownMenu>
								<DropdownMenuTrigger
									render={
										<Button type="button" variant="outline" className="gap-2" />
									}
								>
									<Icon icon="ph:arrows-left-right" className="size-4" />
									{t("workflow.transition")}
								</DropdownMenuTrigger>
								<DropdownMenuContent align="end">
									{allowedTransitions.map((stage) => (
										<DropdownMenuItem
											key={stage.name}
											onClick={() =>
												setTransitionTarget({
													name: stage.name,
													label: stage.label,
												})
											}
										>
											<Icon icon="ph:arrow-right" className="mr-2 size-4" />
											{stage.label || stage.name}
										</DropdownMenuItem>
									))}
								</DropdownMenuContent>
							</DropdownMenu>
						)}

						<Button
							type="button"
							variant="outline"
							size="icon"
							className="size-9"
							onClick={() => setIsHistoryOpen(true)}
							title={t("history.title")}
						>
							<Icon icon="ph:clock-counter-clockwise" className="size-4" />
							<span className="sr-only">{t("history.title")}</span>
						</Button>
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

			<HistorySidebar
				open={isHistoryOpen}
				onOpenChange={setIsHistoryOpen}
				auditEntries={auditData ?? []}
				isLoadingAudit={auditLoading}
				versions={(versionsData ?? []) as any[]}
				isLoadingVersions={versionsLoading}
				isReverting={revertVersionMutation.isPending}
				onRevert={async (version) => {
					setPendingRevertVersion(version);
				}}
				showVersionsTab={!!globalSchema?.options?.versioning}
			/>

			<ConfirmationDialog
				open={!!pendingRevertVersion}
				onOpenChange={(open) => {
					if (!open) setPendingRevertVersion(null);
				}}
				config={{
					title: t("version.revertConfirmTitle"),
					description: t("version.revertConfirmDescription", {
						number:
							pendingRevertVersion?.versionNumber ??
							pendingRevertVersion?.versionId ??
							"-",
					}),
					confirmLabel: t("version.revert"),
					cancelLabel: t("common.cancel"),
					destructive: false,
				}}
				onConfirm={confirmRevertVersion}
				loading={revertVersionMutation.isPending}
			/>

			{/* Workflow Transition Confirmation Dialog */}
			<Dialog
				open={!!transitionTarget}
				onOpenChange={(open) => {
					if (!open) {
						setTransitionTarget(null);
						setTransitionSchedule(false);
						setTransitionScheduledAt(null);
					}
				}}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Icon icon="ph:arrows-left-right" className="size-5" />
							{t("workflow.transitionTo", {
								stage: transitionTarget?.label ?? transitionTarget?.name ?? "",
							})}
						</DialogTitle>
						<DialogDescription>
							{t("workflow.transitionDescription", {
								from: currentStageLabel,
								to: transitionTarget?.label ?? transitionTarget?.name ?? "",
							})}
						</DialogDescription>
					</DialogHeader>

					{/* Optional scheduling */}
					<div className="space-y-3 py-2">
						<div className="flex items-center gap-2">
							<Checkbox
								checked={transitionSchedule}
								onCheckedChange={(val) => {
									setTransitionSchedule(!!val);
									if (!val) setTransitionScheduledAt(null);
								}}
								id="global-transition-schedule"
							/>
							<Label
								htmlFor="global-transition-schedule"
								className="text-sm cursor-pointer"
							>
								{t("workflow.scheduleLabel")}
							</Label>
						</div>

						{transitionSchedule && (
							<div className="space-y-1.5 pl-6">
								<Label className="text-xs text-muted-foreground">
									{t("workflow.scheduledAt")}
								</Label>
								<DateTimeInput
									value={transitionScheduledAt}
									onChange={setTransitionScheduledAt}
									minDate={new Date()}
								/>
								<p className="text-xs text-muted-foreground">
									{t("workflow.scheduledDescription")}
								</p>
							</div>
						)}
					</div>

					<DialogFooter>
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								setTransitionTarget(null);
								setTransitionSchedule(false);
								setTransitionScheduledAt(null);
							}}
						>
							{t("common.cancel")}
						</Button>
						<Button
							type="button"
							onClick={confirmTransition}
							disabled={
								transitionMutation.isPending ||
								(transitionSchedule && !transitionScheduledAt)
							}
							className="gap-2"
						>
							{transitionMutation.isPending && (
								<Icon icon="ph:spinner-gap" className="size-4 animate-spin" />
							)}
							{transitionSchedule
								? t("workflow.scheduleLabel")
								: t("workflow.transition")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</FormProvider>
	);
}
