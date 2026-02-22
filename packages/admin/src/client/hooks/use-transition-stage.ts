/**
 * Workflow Transition Hook
 *
 * Provides a mutation for transitioning collection/global records between
 * workflow stages. Supports optional scheduled transitions via `scheduledAt`.
 *
 * Uses direct fetch (same pattern as audit fetcher) because the generated
 * client SDK does not yet expose the `scheduledAt` parameter.
 *
 * @example
 * ```tsx
 * // Collection transition
 * const transition = useTransitionStage("posts");
 * await transition.mutateAsync({ id: "123", stage: "published" });
 *
 * // Scheduled transition
 * await transition.mutateAsync({
 *   id: "123",
 *   stage: "published",
 *   scheduledAt: new Date("2025-03-01T09:00:00Z"),
 * });
 *
 * // Global transition (no id needed)
 * const globalTransition = useTransitionStage("siteSettings", { mode: "global" });
 * await globalTransition.mutateAsync({ stage: "published" });
 * ```
 */

import {
	type UseMutationOptions,
	useMutation,
	useQueryClient,
} from "@tanstack/react-query";
import * as React from "react";
import { selectClient, useAdminStore } from "../runtime";

// ============================================================================
// Types
// ============================================================================

interface TransitionStageParams {
	/** Record ID (required for collections, ignored for globals) */
	id?: string;
	/** Target stage name */
	stage: string;
	/** Optional ISO date string or Date for scheduled transitions */
	scheduledAt?: string | Date;
}

interface TransitionStageResult {
	[key: string]: unknown;
}

interface UseTransitionStageOptions {
	/**
	 * Whether this is a collection or global transition.
	 * @default "collection"
	 */
	mode?: "collection" | "global";
	/** Extra mutation options passed to useMutation */
	mutationOptions?: Omit<
		UseMutationOptions<TransitionStageResult, Error, TransitionStageParams>,
		"mutationFn"
	>;
}

// ============================================================================
// Hook
// ============================================================================

/**
 * Hook for transitioning a collection record or global between workflow stages.
 *
 * Invalidates relevant queries on success so the UI refreshes automatically
 * (collection/global data, versions, audit history).
 *
 * @param resourceName - Collection slug or global name
 * @param options - Optional configuration (mode, mutationOptions)
 */
export function useTransitionStage(
	resourceName: string,
	options?: UseTransitionStageOptions,
) {
	const mode = options?.mode ?? "collection";
	const client = useAdminStore(selectClient);
	const queryClient = useQueryClient();

	const basePath = React.useMemo(
		() => (client as any).getBasePath?.() ?? "",
		[client],
	);

	return useMutation<TransitionStageResult, Error, TransitionStageParams>({
		mutationFn: async (params) => {
			const body: Record<string, unknown> = { stage: params.stage };

			if (params.scheduledAt) {
				body.scheduledAt =
					params.scheduledAt instanceof Date
						? params.scheduledAt.toISOString()
						: params.scheduledAt;
			}

			const url =
				mode === "global"
					? `${basePath}/globals/${resourceName}/transition`
					: `${basePath}/${resourceName}/${params.id}/transition`;

			const response = await fetch(url, {
				method: "POST",
				credentials: "include",
				headers: {
					"Content-Type": "application/json",
					Accept: "application/json",
				},
				body: JSON.stringify(body),
			});

			if (!response.ok) {
				const error = await response.json().catch(() => ({}));
				throw new Error(error.message ?? error.error ?? "Transition failed");
			}

			return response.json();
		},
		onSuccess: () => {
			// Invalidate collection/global data + versions + audit so the UI
			// picks up the new stage, version snapshot, and audit entry.
			if (mode === "collection") {
				queryClient.invalidateQueries({
					queryKey: ["questpie", "collections", resourceName],
				});
			} else {
				queryClient.invalidateQueries({
					queryKey: ["questpie", "globals", resourceName],
				});
			}
			queryClient.invalidateQueries({
				queryKey: ["questpie", "audit", mode, resourceName],
			});
		},
		...options?.mutationOptions,
	});
}
