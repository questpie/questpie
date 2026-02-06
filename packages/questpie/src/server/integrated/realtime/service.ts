import { asc, desc, gt, lt } from "drizzle-orm";
import type {
  DbClientType,
  DrizzleClientFromQuestpieConfig,
} from "#questpie/server/config/types.js";
import type { RealtimeAdapter } from "./adapter.js";
import { questpieRealtimeLogTable } from "./collection.js";
import type {
  RealtimeChangeEvent,
  RealtimeConfig,
  RealtimeNotice,
  RealtimeOperation,
  RealtimeResourceType,
  RealtimeSubscriptionContext,
} from "./types.js";

export type RealtimeListener = (event: RealtimeChangeEvent) => void;

type AppendChangeInput = Omit<RealtimeChangeEvent, "seq" | "createdAt">;

type AppendChangeOptions = {
  db?: DrizzleClientFromQuestpieConfig<any>;
};

type ListenerEntry = {
  listener: RealtimeListener;
  topics: import("./types").RealtimeTopics;
  whereFilters: Record<string, unknown>;
  hasComplexWhere: boolean;
  lastDeliveredSeq: number;
  // Track which resources this listener cares about (main + dependencies)
  watchedResources: {
    collections: Set<string>;
    globals: Set<string>;
  };
};

/**
 * Extract simple equality filters from WHERE clause
 * Only extracts { field: value } and { field: { eq: value } }
 * Ignores complex operators, relations, AND/OR/NOT
 */
function extractSimpleEquality(where: any): Record<string, any> {
  if (!where || typeof where !== "object") return {};

  const result: Record<string, any> = {};

  for (const [key, value] of Object.entries(where)) {
    // Skip logical operators and relations
    if (["AND", "OR", "NOT", "RAW"].includes(key)) continue;

    // Simple equality: { field: value }
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      result[key] = value;
    }
    // Operator syntax: { field: { eq: value } }
    else if (value && typeof value === "object" && "eq" in value) {
      result[key] = value.eq;
    }
  }

  return result;
}

/**
 * Analyze WHERE clause for realtime matching strategy.
 * - `filters`: simple equality subset used for fast create matching
 * - `hasComplex`: true when where contains logical operators or non-equality operators
 *
 * When `hasComplex` is true we must avoid strict payload-only filtering to prevent
 * false negatives (stale snapshots) for create events.
 */
function analyzeWhere(where: any): {
  filters: Record<string, unknown>;
  hasComplex: boolean;
} {
  if (!where || typeof where !== "object") {
    return { filters: {}, hasComplex: false };
  }

  const filters: Record<string, unknown> = {};
  let hasComplex = false;

  for (const [key, value] of Object.entries(where)) {
    if (["AND", "OR", "NOT", "RAW"].includes(key)) {
      hasComplex = true;
      continue;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      filters[key] = value;
      continue;
    }

    if (value && typeof value === "object") {
      const valueObject = value as Record<string, unknown>;
      if ("eq" in valueObject) {
        filters[key] = valueObject.eq;

        const operatorKeys = Object.keys(valueObject).filter((k) => k !== "eq");
        if (operatorKeys.length > 0) {
          hasComplex = true;
        }
        continue;
      }

      hasComplex = true;
      continue;
    }

    hasComplex = true;
  }

  return { filters, hasComplex };
}

export class RealtimeService {
  private adapter?: RealtimeAdapter;
  private listeners = new Set<ListenerEntry>();
  private directCollectionListeners = new Map<string, Set<ListenerEntry>>();
  private directGlobalListeners = new Map<string, Set<ListenerEntry>>();
  private watchedCollectionListeners = new Map<string, Set<ListenerEntry>>();
  private watchedGlobalListeners = new Map<string, Set<ListenerEntry>>();
  private pollIntervalMs: number;
  private batchSize: number;
  private draining = false;
  private started = false;
  private startPromise: Promise<void> | null = null;
  private lastSeq = 0;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeAdapter: (() => void) | null = null;
  private subscriptionContext?: RealtimeSubscriptionContext;
  private retentionDays?: number;
  private retentionCleanupIntervalMs: number;
  private nextRetentionCleanupAt = 0;
  private retentionCleanupInProgress = false;

  constructor(
    // TODO: this should be typed better
    private db: DrizzleClientFromQuestpieConfig<any>,
    config: RealtimeConfig = {},
    private pgConnectionString?: string,
  ) {
    // Auto-configure adapter if connection string is provided
    if (config.adapter) {
      // User provided custom adapter
      this.adapter = config.adapter;
    }
    // PgNotifyAdapter will be lazily created on first subscribe (if needed)

    this.batchSize = config.batchSize ?? 500;
    this.pollIntervalMs = config.pollIntervalMs ?? (this.adapter ? 0 : 2000);
    this.retentionDays =
      typeof config.retentionDays === "number" && config.retentionDays > 0
        ? config.retentionDays
        : undefined;
    this.retentionCleanupIntervalMs = 60 * 60 * 1000;
  }

  /**
   * Set context for resolving dependencies from WITH config.
   * Called by CMS to provide collection/global resolution functions.
   */
  setSubscriptionContext(context: RealtimeSubscriptionContext): void {
    this.subscriptionContext = context;
  }

  private addIndexedListener(
    index: Map<string, Set<ListenerEntry>>,
    resource: string,
    entry: ListenerEntry,
  ): void {
    if (!index.has(resource)) {
      index.set(resource, new Set());
    }

    index.get(resource)?.add(entry);
  }

  private removeIndexedListener(
    index: Map<string, Set<ListenerEntry>>,
    resource: string,
    entry: ListenerEntry,
  ): void {
    const listeners = index.get(resource);
    if (!listeners) return;

    listeners.delete(entry);
    if (listeners.size === 0) {
      index.delete(resource);
    }
  }

  private collectIndexedCandidates(
    index: Map<string, Set<ListenerEntry>>,
    resource: string,
    collector: Set<ListenerEntry>,
  ): void {
    const exact = index.get(resource);
    if (exact) {
      for (const entry of exact) collector.add(entry);
    }

    const wildcard = index.get("*");
    if (wildcard) {
      for (const entry of wildcard) collector.add(entry);
    }
  }

  async appendChange(
    input: AppendChangeInput,
    options: AppendChangeOptions = {},
  ): Promise<RealtimeChangeEvent> {
    const db = options.db ?? this.db;
    const [row] = await db
      .insert(questpieRealtimeLogTable)
      .values({
        resourceType: input.resourceType,
        resource: input.resource,
        operation: input.operation,
        recordId: input.recordId ?? null,
        locale: input.locale ?? null,
        payload: input.payload ?? {},
      })
      .returning();

    const event = {
      seq: Number(row.seq),
      resourceType: row.resourceType as RealtimeResourceType,
      resource: row.resource,
      operation: row.operation as RealtimeOperation,
      recordId: row.recordId ?? null,
      locale: row.locale ?? null,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt,
    };

    void this.scheduleRetentionCleanup();
    return event;
  }

  async notify(event: RealtimeChangeEvent): Promise<void> {
    if (!this.adapter) return;
    await this.adapter.notify(event);
  }

  /**
   * Run realtime outbox cleanup immediately.
   *
   * Useful for scheduled queue jobs (for example starter module cron jobs).
   */
  async cleanupOutbox(force = true): Promise<void> {
    await this.scheduleRetentionCleanup(force);
  }

  subscribe(
    listener: RealtimeListener,
    topics?: import("./types").RealtimeTopics,
  ): () => void {
    const resolvedTopics = topics ?? {
      resourceType: "collection",
      resource: "*",
    };
    const whereAnalysis = analyzeWhere(resolvedTopics.where);

    // Resolve dependencies from WITH config
    let watchedResources: { collections: Set<string>; globals: Set<string> };

    if (resolvedTopics.resourceType === "collection" && resolvedTopics.with) {
      const collections =
        this.subscriptionContext?.resolveCollectionDependencies?.(
          resolvedTopics.resource,
          resolvedTopics.with,
        ) ?? new Set([resolvedTopics.resource]);
      watchedResources = { collections, globals: new Set() };
    } else if (
      resolvedTopics.resourceType === "global" &&
      resolvedTopics.with
    ) {
      watchedResources = this.subscriptionContext?.resolveGlobalDependencies?.(
        resolvedTopics.resource,
        resolvedTopics.with,
      ) ?? {
        collections: new Set(),
        globals: new Set([resolvedTopics.resource]),
      };
    } else {
      // No WITH config - only watch main resource
      watchedResources =
        resolvedTopics.resourceType === "collection"
          ? {
              collections: new Set([resolvedTopics.resource]),
              globals: new Set(),
            }
          : {
              collections: new Set(),
              globals: new Set([resolvedTopics.resource]),
            };
    }

    const entry: ListenerEntry = {
      listener,
      topics: resolvedTopics,
      whereFilters: whereAnalysis.filters,
      hasComplexWhere: whereAnalysis.hasComplex,
      lastDeliveredSeq: this.lastSeq,
      watchedResources,
    };

    this.listeners.add(entry);

    const directIndex =
      resolvedTopics.resourceType === "collection"
        ? this.directCollectionListeners
        : this.directGlobalListeners;
    this.addIndexedListener(directIndex, resolvedTopics.resource, entry);

    for (const resource of watchedResources.collections) {
      this.addIndexedListener(this.watchedCollectionListeners, resource, entry);
    }

    for (const resource of watchedResources.globals) {
      this.addIndexedListener(this.watchedGlobalListeners, resource, entry);
    }

    void this.ensureStarted();

    return () => {
      this.listeners.delete(entry);

      const removeDirectIndex =
        resolvedTopics.resourceType === "collection"
          ? this.directCollectionListeners
          : this.directGlobalListeners;
      this.removeIndexedListener(
        removeDirectIndex,
        resolvedTopics.resource,
        entry,
      );

      for (const resource of watchedResources.collections) {
        this.removeIndexedListener(
          this.watchedCollectionListeners,
          resource,
          entry,
        );
      }

      for (const resource of watchedResources.globals) {
        this.removeIndexedListener(
          this.watchedGlobalListeners,
          resource,
          entry,
        );
      }

      if (this.listeners.size === 0) {
        void this.stop();
      }
    };
  }

  async getLatestSeq(): Promise<number> {
    const rows = await this.db
      .select({ seq: questpieRealtimeLogTable.seq })
      .from(questpieRealtimeLogTable)
      .orderBy(desc(questpieRealtimeLogTable.seq))
      .limit(1);
    return rows[0]?.seq ? Number(rows[0].seq) : 0;
  }

  private async readSince(seq: number): Promise<RealtimeChangeEvent[]> {
    const rows = await this.db
      .select()
      .from(questpieRealtimeLogTable)
      .where(gt(questpieRealtimeLogTable.seq, seq))
      .orderBy(asc(questpieRealtimeLogTable.seq))
      .limit(this.batchSize);

    return rows.map((row: any) => ({
      seq: Number(row.seq),
      resourceType: row.resourceType as RealtimeResourceType,
      resource: row.resource,
      operation: row.operation as RealtimeOperation,
      recordId: row.recordId ?? null,
      locale: row.locale ?? null,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt,
    }));
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    if (this.startPromise) {
      await this.startPromise;
      return;
    }

    this.startPromise = (async () => {
      const latestSeq = await this.getLatestSeq();

      // Lazy-load pg-notify adapter if Postgres connection string is available
      if (!this.adapter && this.pgConnectionString) {
        const { PgNotifyAdapter } = await import("./adapters/pg-notify");
        this.adapter = new PgNotifyAdapter({
          connectionString: this.pgConnectionString,
          channel: "questpie_realtime",
        });
      }

      if (this.adapter) {
        await this.adapter.start();
        this.unsubscribeAdapter = this.adapter.subscribe(() => {
          void this.drain();
        });
      } else if (this.pollIntervalMs > 0) {
        this.pollTimer = setInterval(() => {
          void this.drain();
        }, this.pollIntervalMs);
      }

      this.lastSeq = latestSeq;
      this.started = true;
      void this.drain();
      void this.scheduleRetentionCleanup(true);
    })()
      .catch(async (error) => {
        this.started = false;

        if (this.pollTimer) {
          clearInterval(this.pollTimer);
          this.pollTimer = null;
        }

        if (this.unsubscribeAdapter) {
          this.unsubscribeAdapter();
          this.unsubscribeAdapter = null;
        }

        if (this.adapter) {
          try {
            await this.adapter.stop();
          } catch {
            // Ignore stop failures during failed startup cleanup
          }
        }

        throw error;
      })
      .finally(() => {
        this.startPromise = null;
      });

    await this.startPromise;
  }

  private async stop(): Promise<void> {
    if (!this.started && !this.startPromise) return;

    if (this.startPromise) {
      try {
        await this.startPromise;
      } catch {
        // startup already failed, continue cleanup
      }
    }

    if (!this.started) return;
    this.started = false;

    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.unsubscribeAdapter) {
      this.unsubscribeAdapter();
      this.unsubscribeAdapter = null;
    }

    if (this.adapter) {
      await this.adapter.stop();
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;

    try {
      while (true) {
        const events = await this.readSince(this.lastSeq);
        if (events.length === 0) break;

        this.lastSeq = events[events.length - 1].seq;
        for (const event of events) {
          this.emit(event);
        }

        if (events.length < this.batchSize) break;
      }
    } finally {
      this.draining = false;
    }
  }

  private emit(event: RealtimeChangeEvent): void {
    // Extract simple equality filters from event payload for matching
    const eventFilters = event.payload
      ? extractSimpleEquality(event.payload)
      : {};

    const candidates = new Set<ListenerEntry>();
    if (event.resourceType === "collection") {
      this.collectIndexedCandidates(
        this.directCollectionListeners,
        event.resource,
        candidates,
      );
      this.collectIndexedCandidates(
        this.watchedCollectionListeners,
        event.resource,
        candidates,
      );
    } else {
      this.collectIndexedCandidates(
        this.directGlobalListeners,
        event.resource,
        candidates,
      );
      this.collectIndexedCandidates(
        this.watchedGlobalListeners,
        event.resource,
        candidates,
      );
    }

    const notifiedListeners = new Set<ListenerEntry>();

    for (const entry of candidates) {
      if (notifiedListeners.has(entry)) continue;

      const isDirectMatch =
        entry.topics.resourceType === event.resourceType &&
        (entry.topics.resource === event.resource ||
          entry.topics.resource === "*");

      if (!isDirectMatch) {
        notifiedListeners.add(entry);
        continue;
      }

      if (!entry.topics.where) {
        notifiedListeners.add(entry);
        continue;
      }

      // For update/delete/bulk operations we do not have previous state in the
      // event stream, so strict payload-only filtering can miss transitions where
      // a record leaves the subscriber filter set. Always refresh these subscribers.
      if (event.operation !== "create") {
        notifiedListeners.add(entry);
        continue;
      }

      // Complex WHERE clauses cannot be safely evaluated from payload-only filters.
      // Refresh to avoid false negatives for OR/nested/operator-heavy conditions.
      if (entry.hasComplexWhere) {
        notifiedListeners.add(entry);
        continue;
      }

      const allFiltersMatch = Object.entries(entry.whereFilters).every(
        ([key, value]) => eventFilters[key] === value,
      );

      if (allFiltersMatch) {
        notifiedListeners.add(entry);
      }
    }

    // Notify all collected listeners
    for (const entry of notifiedListeners) {
      entry.lastDeliveredSeq = Math.max(entry.lastDeliveredSeq, event.seq);
      entry.listener(event);
    }

    void this.scheduleRetentionCleanup();
  }

  private getMinConsumedSeq(): number | null {
    if (this.listeners.size === 0) return null;

    let min = Number.POSITIVE_INFINITY;
    for (const entry of this.listeners) {
      min = Math.min(min, entry.lastDeliveredSeq);
    }

    if (!Number.isFinite(min) || min <= 0) return null;
    return min;
  }

  private async scheduleRetentionCleanup(force = false): Promise<void> {
    const hasTimeRetention = !!this.retentionDays && this.retentionDays > 0;
    const minConsumedSeq = this.getMinConsumedSeq();
    const hasWatermarkCleanup = !!minConsumedSeq;

    if (!hasTimeRetention && !hasWatermarkCleanup) return;

    const now = Date.now();
    if (!force && now < this.nextRetentionCleanupAt) return;
    if (this.retentionCleanupInProgress) return;

    this.retentionCleanupInProgress = true;
    this.nextRetentionCleanupAt = now + this.retentionCleanupIntervalMs;

    try {
      if (hasTimeRetention) {
        const cutoff = new Date(
          now - (this.retentionDays as number) * 24 * 60 * 60 * 1000,
        );
        await this.db
          .delete(questpieRealtimeLogTable)
          .where(lt(questpieRealtimeLogTable.createdAt, cutoff));
      }

      if (hasWatermarkCleanup) {
        await this.db
          .delete(questpieRealtimeLogTable)
          .where(lt(questpieRealtimeLogTable.seq, minConsumedSeq as number));
      }
    } catch {
      // Best-effort cleanup; keep realtime delivery resilient to cleanup failures.
    } finally {
      this.retentionCleanupInProgress = false;
    }
  }

  static noticeFromEvent(event: RealtimeChangeEvent): RealtimeNotice {
    return {
      seq: event.seq,
      resourceType: event.resourceType,
      resource: event.resource,
      operation: event.operation,
    };
  }
}
