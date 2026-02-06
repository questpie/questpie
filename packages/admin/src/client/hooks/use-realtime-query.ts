import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import { selectRealtime, useAdminStore } from "../runtime";

type RealtimeResource =
  | {
      resourceType: "collection";
      resource: string;
      options?: Record<string, unknown>;
    }
  | {
      resourceType: "global";
      resource: string;
      options?: Record<string, unknown>;
    };

type RealtimeQueryInvalidationParams = {
  queryKey: QueryKey | undefined;
  realtime?: boolean;
  resource: RealtimeResource;
  mapSnapshotToQueryData?: (snapshotData: unknown) => unknown | undefined;
};

function isAbsoluteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function normalizeCmsBasePath(basePath: string): string {
  if (isAbsoluteUrl(basePath)) {
    const trimmedAbsolute = basePath.replace(/\/$/, "");
    if (trimmedAbsolute.endsWith("/cms")) {
      return trimmedAbsolute;
    }
    return `${trimmedAbsolute}/cms`;
  }

  const normalized = basePath.startsWith("/") ? basePath : `/${basePath}`;
  const trimmed = normalized.replace(/\/$/, "");

  if (trimmed.endsWith("/cms") || trimmed === "/cms") {
    return trimmed;
  }

  return `${trimmed}/cms`;
}

function appendNestedParams(
  params: URLSearchParams,
  key: string,
  value: unknown,
): void {
  if (value === undefined || value === null) return;

  if (value instanceof Date) {
    params.append(key, value.toISOString());
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      appendNestedParams(params, `${key}[]`, entry);
    }
    return;
  }

  if (typeof value === "object") {
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      appendNestedParams(params, `${key}[${nestedKey}]`, nestedValue);
    }
    return;
  }

  params.append(key, String(value));
}

function buildQueryString(options?: Record<string, unknown>): string {
  if (!options) return "";

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(options)) {
    appendNestedParams(params, key, value);
  }

  const query = params.toString();
  return query ? `?${query}` : "";
}

function getRealtimePath(
  basePath: string,
  resourceType: RealtimeResource["resourceType"],
  resourceName: string,
  queryString: string,
): string {
  const cmsBasePath = normalizeCmsBasePath(basePath);

  if (resourceType === "global") {
    return `${cmsBasePath}/realtime/globals/${encodeURIComponent(resourceName)}${queryString}`;
  }

  return `${cmsBasePath}/realtime/${encodeURIComponent(resourceName)}${queryString}`;
}

export function useRealtimeQueryInvalidation({
  queryKey,
  realtime,
  resource,
  mapSnapshotToQueryData,
}: RealtimeQueryInvalidationParams): void {
  const queryClient = useQueryClient();
  const realtimeConfig = useAdminStore(selectRealtime);
  const resourceType = resource.resourceType;
  const resourceName = resource.resource;
  const resourceOptions = resource.options;

  const enabled = realtime ?? realtimeConfig.enabled;
  const debounceMs = Math.max(0, realtimeConfig.debounceMs ?? 0);
  const queryString = React.useMemo(
    () => buildQueryString(resourceOptions),
    [resourceOptions],
  );

  const realtimeUrl = React.useMemo(() => {
    if (!enabled) return null;
    if (!queryKey) return null;
    if (typeof window === "undefined" || typeof EventSource === "undefined") {
      return null;
    }

    const path = getRealtimePath(
      realtimeConfig.basePath,
      resourceType,
      resourceName,
      queryString,
    );
    return isAbsoluteUrl(path) ? path : `${window.location.origin}${path}`;
  }, [
    enabled,
    queryKey,
    realtimeConfig.basePath,
    resourceName,
    resourceType,
    queryString,
  ]);

  React.useEffect(() => {
    if (!realtimeUrl || !queryKey) return;

    const eventSource = new EventSource(realtimeUrl, { withCredentials: true });
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingSnapshotData: unknown | undefined;
    let hasPendingSnapshot = false;

    const applySnapshotOrInvalidate = () => {
      if (hasPendingSnapshot) {
        queryClient.setQueryData(queryKey, pendingSnapshotData);
      } else {
        queryClient.invalidateQueries({ queryKey });
      }

      hasPendingSnapshot = false;
      pendingSnapshotData = undefined;
      flushTimer = null;
    };

    const scheduleFlush = () => {
      if (debounceMs <= 0) {
        applySnapshotOrInvalidate();
        return;
      }

      if (flushTimer) {
        clearTimeout(flushTimer);
      }

      flushTimer = setTimeout(() => {
        applySnapshotOrInvalidate();
      }, debounceMs);
    };

    const onSnapshot = (event: Event) => {
      const message = event as MessageEvent<string>;

      try {
        const parsed = JSON.parse(message.data ?? "null") as {
          data?: unknown;
        };
        const rawSnapshotData = parsed?.data;
        const mappedSnapshotData = mapSnapshotToQueryData
          ? mapSnapshotToQueryData(rawSnapshotData)
          : rawSnapshotData;

        if (mappedSnapshotData !== undefined) {
          hasPendingSnapshot = true;
          pendingSnapshotData = mappedSnapshotData;
        } else {
          hasPendingSnapshot = false;
          pendingSnapshotData = undefined;
        }
      } catch {
        hasPendingSnapshot = false;
        pendingSnapshotData = undefined;
      }

      scheduleFlush();
    };

    eventSource.addEventListener("snapshot", onSnapshot);

    return () => {
      if (flushTimer) {
        clearTimeout(flushTimer);
      }
      eventSource.removeEventListener("snapshot", onSnapshot);
      eventSource.close();
    };
  }, [realtimeUrl, queryKey, queryClient, debounceMs, mapSnapshotToQueryData]);
}

export function useCollectionRealtimeInvalidation(params: {
  collection: string;
  queryKey: QueryKey | undefined;
  realtime?: boolean;
  options?: Record<string, unknown>;
  mapSnapshotToQueryData?: (snapshotData: unknown) => unknown | undefined;
}): void {
  useRealtimeQueryInvalidation({
    queryKey: params.queryKey,
    realtime: params.realtime,
    mapSnapshotToQueryData: params.mapSnapshotToQueryData,
    resource: {
      resourceType: "collection",
      resource: params.collection,
      options: params.options,
    },
  });
}

export function useGlobalRealtimeInvalidation(params: {
  global: string;
  queryKey: QueryKey | undefined;
  realtime?: boolean;
  options?: Record<string, unknown>;
  mapSnapshotToQueryData?: (snapshotData: unknown) => unknown | undefined;
}): void {
  useRealtimeQueryInvalidation({
    queryKey: params.queryKey,
    realtime: params.realtime,
    mapSnapshotToQueryData: params.mapSnapshotToQueryData,
    resource: {
      resourceType: "global",
      resource: params.global,
      options: params.options,
    },
  });
}
