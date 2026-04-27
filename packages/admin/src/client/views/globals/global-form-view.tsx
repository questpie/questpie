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
import { EmptyState } from "../../components/ui/empty-state";
import { Label } from "../../components/ui/label";
import { Skeleton } from "../../components/ui/skeleton";
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
import {
	detectManyToManyRelations,
	hasManyToManyRelations,
} from "../../utils/detect-relations";
import { shouldHandleAdminShortcut } from "../../utils/keyboard-shortcuts";
import { AutoFormFields } from "../collection/auto-form-fields";
import { AdminViewHeader } from "../layout/admin-view-layout";

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

function GlobalFormViewSkeleton() {
	return (
		<div className="qa-global-form w-full space-y-4" aria-busy="true">
			<span className="sr-only">Loading global form</span>
			<AdminViewHeader
				title={<Skeleton variant="text" className="h-7 w-48" />}
				meta={<Skeleton variant="text" className="h-3 w-36" />}
				actions={
					<>
						<Skeleton className="size-8" />
						<Skeleton className="h-8 w-20" />
					</>
				}
			/>
			<div className="space-y-4">
				<div className="space-y-2">
					<Skeleton variant="text" className="h-4 w-24" />
					<Skeleton className="h-10 w-full" />
				</div>
				<div className="space-y-2">
					<Skeleton variant="text" className="h-4 w-32" />
					<Skeleton className="h-10 w-full" />
				</div>
				<div className="space-y-2">
					<Skeleton variant="text" className="h-4 w-28" />
					<Skeleton className="h-32 w-full" />
				</div>
			</div>
		</div>
	);
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

	const { fields: schemaFields, schema: globalSchema } =
		useGlobalFields(globalName);

	// Auto-detect M:N relations (e.g. upload-through) — they are virtual and
	// are NOT included in the response unless explicitly requested via `with`.
	const withRelations = React.useMemo(
		() =>
			detectManyToManyRelations({
				fields: config?.fields as any,
				schema: globalSchema as any,
			}),
		[config?.fields, globalSchema],
	);

	const {
		data: globalDataRaw,
		isLoading: dataLoading,
		error: dataError,
	} = useGlobal(
		globalName,
		hasManyToManyRelations(withRelations) ? { with: withRelations } : undefined,
	);

	// Backend returns relation arrays as { id, ... } objects but the form needs
	// arrays of ids — same transform CollectionFormView does for editing.
	const globalData = React.useMemo(() => {
		if (!globalDataRaw || !hasManyToManyRelations(withRelations)) {
			return globalDataRaw;
		}
		const result: Record<string, any> = { ...(globalDataRaw as any) };
		for (const key of Object.keys(withRelations)) {
			const value = result[key];
			if (
				Array.isArray(value) &&
				value.length > 0 &&
				typeof value[0] === "object" &&
				value[0]?.id
			) {
				result[key] = value.map((v: any) => v.id);
			}
		}
		return result;
	}, [globalDataRaw, withRelations]);

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

	// Locale change dirty guard
	const prevLocaleRef = React.useRef(contentLocale);
	const skipResetRef = React.useRef(false);
	const localeSnapshotRef = React.useRef<Record<string, any> | null>(null);
	const [localeChangeDialog, setLocaleChangeDialog] = React.useState<{
		open: boolean;
		pendingLocale: string | null;
	}>({ open: false, pendingLocale: null });

	React.useEffect(() => {
		if (prevLocaleRef.current !== contentLocale) {
			if (form.formState.isDirty && !localeChangeDialog.open) {
				skipResetRef.current = true;
				localeSnapshotRef.current = form.getValues();
				setLocaleChangeDialog({ open: true, pendingLocale: contentLocale });
				setContentLocale(prevLocaleRef.current);
			} else {
				prevLocaleRef.current = contentLocale;
				skipResetRef.current = false;
			}
		}
	}, [
		contentLocale,
		form.formState.isDirty,
		localeChangeDialog.open,
		setContentLocale,
		form,
	]);

	const handleLocaleChangeConfirm = React.useCallback(() => {
		skipResetRef.current = false;
		localeSnapshotRef.current = null;
		if (localeChangeDialog.pendingLocale) {
			prevLocaleRef.current = localeChangeDialog.pendingLocale;
			setContentLocale(localeChangeDialog.pendingLocale);
		}
		setLocaleChangeDialog({ open: false, pendingLocale: null });
	}, [localeChangeDialog.pendingLocale, setContentLocale]);

	const handleLocaleChangeCancel = React.useCallback(() => {
		skipResetRef.current = false;
		if (localeSnapshotRef.current) {
			form.reset(localeSnapshotRef.current, {
				keepDirty: true,
				keepDirtyValues: true,
				keepErrors: true,
				keepTouched: true,
			});
		}
		localeSnapshotRef.current = null;
		setLocaleChangeDialog({ open: false, pendingLocale: null });
	}, [form]);

	// Reset form when data loads
	React.useEffect(() => {
		if (skipResetRef.current) return;
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
		form,
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
			if (
				shouldHandleAdminShortcut(e, {
					allowEditableTarget: true,
					key: "s",
				})
			) {
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

	if (dataError) {
		return (
			<EmptyState
				variant="error"
				iconName="ph:warning-circle"
				title={t("error.failedToLoad")}
				description={dataError instanceof Error ? dataError.message : undefined}
				height="h-64"
				action={
					<Button
						variant="outline"
						size="sm"
						className="gap-2"
						onClick={() => window.location.reload()}
					>
						<Icon icon="ph:arrow-clockwise" className="size-3.5" />
						{t("common.retry")}
					</Button>
				}
			/>
		);
	}

	if (dataLoading) {
		return <GlobalFormViewSkeleton />;
	}

	const globalLabel = resolveText(
		(resolvedConfig as any)?.label ?? schemaFields?._globalLabel,
		globalName,
	);

	return (
		<FormProvider {...form}>
			<form
				onSubmit={form.handleSubmit(onSubmit)}
				className="qa-global-form w-full space-y-4"
			>
				<AdminViewHeader
					className="qa-global-form__header"
					title={globalLabel}
					titleAccessory={
						<>
							{localeOptions.length > 0 && (
								<LocaleSwitcher
									locales={localeOptions}
									value={contentLocale}
									onChange={setContentLocale}
								/>
							)}
							{workflowEnabled && currentStage && (
								<Badge variant="outline" className="gap-1.5">
									<Icon icon="ph:git-branch" className="size-3" />
									{currentStageLabel}
								</Badge>
							)}
						</>
					}
					meta={
						showMeta && globalData?.updatedAt ? (
							<span>
								{t("form.lastUpdated")}: {formatDate(globalData.updatedAt)}
							</span>
						) : undefined
					}
					actions={
						<>
							{headerActions}

							{/* Workflow transition dropdown */}
							{workflowEnabled && allowedTransitions.length > 0 && (
								<DropdownMenu>
									<DropdownMenuTrigger
										render={
											<Button
												type="button"
												variant="outline"
												size="sm"
												className="gap-2"
											/>
										}
									>
										<Icon icon="ph:arrows-left-right" className="size-3.5" />
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
								size="icon-sm"
								onClick={() => setIsHistoryOpen(true)}
								title={t("history.title")}
							>
								<Icon icon="ph:clock-counter-clockwise" className="size-3.5" />
								<span className="sr-only">{t("history.title")}</span>
							</Button>
							<Button
								type="submit"
								size="sm"
								disabled={isSubmitting}
								className="gap-2"
							>
								{isSubmitting ? (
									<>
										<Icon
											icon="ph:spinner-gap"
											className="size-4 animate-spin"
										/>
										{t("common.loading")}
									</>
								) : (
									<>
										<Icon icon="ph:check" width={16} height={16} />
										{t("common.save")}
									</>
								)}
							</Button>
						</>
					}
				/>

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
				fields={globalSchema?.fields as any}
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
								className="cursor-pointer text-sm"
							>
								{t("workflow.scheduleLabel")}
							</Label>
						</div>

						{transitionSchedule && (
							<div className="space-y-1.5 pl-6">
								<Label className="text-muted-foreground text-xs">
									{t("workflow.scheduledAt")}
								</Label>
								<DateTimeInput
									value={transitionScheduledAt}
									onChange={setTransitionScheduledAt}
									minDate={new Date()}
								/>
								<p className="text-muted-foreground text-xs">
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
			{/* Locale change confirmation dialog */}
			<Dialog
				open={localeChangeDialog.open}
				onOpenChange={(open) => !open && handleLocaleChangeCancel()}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>{t("locale.unsavedChanges")}</DialogTitle>
						<DialogDescription>
							{t("locale.unsavedChangesDescription")}
						</DialogDescription>
					</DialogHeader>
					<DialogFooter>
						<Button variant="outline" onClick={handleLocaleChangeCancel}>
							{t("common.cancel")}
						</Button>
						<Button variant="default" onClick={handleLocaleChangeConfirm}>
							{t("locale.discardChanges")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</FormProvider>
	);
}
