/**
 * Scope Picker Component
 *
 * A dropdown picker for selecting the current scope in multi-tenant apps.
 * Can fetch options from a collection or use static options.
 */

import { Icon } from "@iconify/react";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "../components/ui/select";
import { Skeleton } from "../components/ui/skeleton";
import { cn } from "../lib/utils";
import { useAdminStore } from "../runtime/provider.js";
import { useScope } from "./provider";
import type { ScopeOption, ScopePickerProps } from "./types";

/**
 * Scope Picker Component
 *
 * Renders a dropdown for selecting the current scope.
 * Integrates with ScopeProvider to manage the selected scope.
 *
 * @example
 * ```tsx
 * // Fetch options from a collection
 * <ScopePicker
 *   collection="properties"
 *   labelField="name"
 *   placeholder="Select property..."
 *   allowClear
 * />
 *
 * // Use static options
 * <ScopePicker
 *   options={[
 *     { value: 'org_1', label: 'Organization 1' },
 *     { value: 'org_2', label: 'Organization 2' },
 *   ]}
 * />
 *
 * // Use async options loader
 * <ScopePicker
 *   loadOptions={async () => {
 *     const response = await fetch('/api/my-scopes');
 *     return response.json();
 *   }}
 * />
 * ```
 */
export function ScopePicker({
	collection,
	labelField = "name",
	valueField = "id",
	options: staticOptions,
	loadOptions,
	placeholder = "Select...",
	label,
	allowClear = false,
	clearText = "All",
	className,
	compact = false,
}: ScopePickerProps) {
	const { scopeId, setScope, isLoading: scopeLoading } = useScope();
	const client = useAdminStore((s) => s.client);

	// Fetch options from collection
	const {
		data: collectionData,
		isLoading: collectionLoading,
		error: collectionError,
	} = useQuery({
		queryKey: ["scope-picker", collection, labelField, valueField],
		queryFn: async () => {
			if (!collection || !client) return null;

			const result = await (client.collections as any)[collection].find({
				limit: 100,
				columns: {
					[valueField]: true,
					[labelField]: true,
				},
			});

			return result.docs.map((doc: any) => ({
				value: String(doc[valueField]),
				label: String(doc[labelField] ?? doc[valueField]),
			}));
		},
		enabled: !!collection && !!client,
		staleTime: 60000, // 1 minute
	});

	// Fetch options from async loader
	const {
		data: asyncOptions,
		isLoading: asyncLoading,
		error: asyncError,
	} = useQuery({
		queryKey: ["scope-picker-async", loadOptions?.toString()],
		queryFn: loadOptions!,
		enabled: !!loadOptions,
		staleTime: 60000,
	});

	// Combine options from all sources
	const options = useMemo((): ScopeOption[] => {
		if (staticOptions) return staticOptions;
		if (collectionData) return collectionData;
		if (asyncOptions) return asyncOptions;
		return [];
	}, [staticOptions, collectionData, asyncOptions]);

	const isLoading = scopeLoading || collectionLoading || asyncLoading;
	const error = collectionError || asyncError;

	// Handle selection change
	const handleValueChange = useCallback(
		(value: string | null) => {
			if (!value || value === "__clear__") {
				setScope(null);
			} else {
				setScope(value);
			}
		},
		[setScope],
	);

	// Get current selection label
	const selectedLabel = useMemo(() => {
		if (!scopeId) return null;
		const option = options.find((opt) => opt.value === scopeId);
		return option?.label ?? scopeId;
	}, [scopeId, options]);

	if (isLoading) {
		return (
			<div className={cn("space-y-1.5", className)}>
				{label && !compact && <Skeleton className="h-3 w-16" />}
				<Skeleton className={cn("h-9 w-full", compact && "h-8")} />
			</div>
		);
	}

	if (error) {
		return (
			<div className={cn("text-xs text-destructive", className)}>
				Failed to load options
			</div>
		);
	}

	return (
		<div className={cn("space-y-1.5", className)}>
			{label && !compact && (
				<span className="text-xs font-medium text-muted-foreground">
					{label}
				</span>
			)}
			<Select
				value={scopeId ?? "__clear__"}
				onValueChange={(value) => handleValueChange(value)}
			>
				<SelectTrigger
					className={cn(
						"w-full",
						compact && "h-8 text-xs",
						!scopeId && "text-muted-foreground",
					)}
				>
					<SelectValue placeholder={placeholder}>
						{scopeId ? selectedLabel : allowClear ? clearText : placeholder}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{allowClear && (
						<SelectItem value="__clear__">
							<span className="flex items-center gap-2">
								<Icon
									icon="ph:globe"
									className="size-4 text-muted-foreground"
								/>
								{clearText}
							</span>
						</SelectItem>
					)}
					{options.map((option) => (
						<SelectItem key={option.value} value={option.value}>
							<span className="flex items-center gap-2">
								{option.icon}
								<span>{option.label}</span>
								{option.description && (
									<span className="text-muted-foreground text-xs">
										{option.description}
									</span>
								)}
							</span>
						</SelectItem>
					))}
					{options.length === 0 && (
						<div className="px-2 py-1.5 text-xs text-muted-foreground">
							No options available
						</div>
					)}
				</SelectContent>
			</Select>
		</div>
	);
}
