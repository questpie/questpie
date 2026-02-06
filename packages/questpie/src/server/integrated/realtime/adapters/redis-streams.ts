import type { RealtimeAdapter } from "../adapter.js";
import type { RealtimeChangeEvent, RealtimeNotice } from "../types.js";

export type RedisStreamsClient = {
  xAdd: (
    stream: string,
    id: string,
    fields: Record<string, string>,
  ) => Promise<string>;
  xGroupCreate?: (
    stream: string,
    group: string,
    id: string,
    options?: { MKSTREAM?: boolean },
  ) => Promise<unknown>;
  xReadGroup: (...args: any[]) => Promise<unknown>;
  xAck?: (
    stream: string,
    group: string,
    id: string | string[],
  ) => Promise<unknown>;
  quit?: () => Promise<void>;
  disconnect?: () => void;
};

export type RedisStreamsAdapterOptions = {
  client: RedisStreamsClient;
  stream?: string;
  group?: string;
  consumer?: string;
  blockMs?: number;
  batchSize?: number;
};

export class RedisStreamsAdapter implements RealtimeAdapter {
  private client: RedisStreamsClient;
  private stream: string;
  private group: string;
  private consumer: string;
  private blockMs: number;
  private batchSize: number;
  private listeners = new Set<(notice: RealtimeNotice) => void>();
  private running = false;

  constructor(options: RedisStreamsAdapterOptions) {
    this.client = options.client;
    this.stream = options.stream ?? "questpie:realtime";
    this.group = options.group ?? "questpie-realtime";
    this.consumer =
      options.consumer ??
      `consumer-${
        globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
      }`;
    this.blockMs = options.blockMs ?? 5000;
    this.batchSize = options.batchSize ?? 100;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.ensureGroup();
    this.readLoop().catch(() => {
      this.running = false;
    });
  }

  async stop(): Promise<void> {
    this.running = false;
  }

  subscribe(handler: (notice: RealtimeNotice) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  async notify(event: RealtimeChangeEvent): Promise<void> {
    await this.client.xAdd(this.stream, "*", {
      seq: String(event.seq),
      resourceType: event.resourceType,
      resource: event.resource,
      operation: event.operation,
    });
  }

  private async ensureGroup(): Promise<void> {
    if (!this.client.xGroupCreate) return;
    try {
      await this.client.xGroupCreate(this.stream, this.group, "$", {
        MKSTREAM: true,
      });
    } catch (error: any) {
      const message = String(error?.message || "");
      if (!message.includes("BUSYGROUP")) {
        throw error;
      }
    }
  }

  private async readLoop(): Promise<void> {
    while (this.running) {
      let response: unknown;
      try {
        response = await this.client.xReadGroup(
          "GROUP",
          this.group,
          this.consumer,
          "COUNT",
          this.batchSize,
          "BLOCK",
          this.blockMs,
          "STREAMS",
          this.stream,
          ">",
        );
      } catch {
        if (!this.running) break;
        await new Promise((resolve) => setTimeout(resolve, 500));
        continue;
      }

      const messages = this.normalizeResponse(response);
      if (messages.length === 0) continue;

      for (const message of messages) {
        const notice = this.noticeFromFields(message.fields);
        if (notice) {
          for (const listener of this.listeners) {
            listener(notice);
          }
        }

        if (this.client.xAck) {
          await this.client.xAck(this.stream, this.group, message.id);
        }
      }
    }
  }

  private normalizeResponse(response: any): Array<{ id: string; fields: any }> {
    if (!response || !Array.isArray(response)) return [];
    const entries: Array<{ id: string; fields: any }> = [];

    for (const streamEntry of response) {
      let messages: any[] | null = null;

      if (Array.isArray(streamEntry)) {
        messages = streamEntry[1];
      } else if (streamEntry && typeof streamEntry === "object") {
        messages = (streamEntry as any).messages ?? null;
      }

      if (!Array.isArray(messages)) continue;

      for (const message of messages) {
        if (Array.isArray(message)) {
          const id = message[0];
          const fields = message[1];
          entries.push({ id, fields });
          continue;
        }

        if (message && typeof message === "object") {
          const id = (message as any).id;
          const fields = (message as any).message ?? (message as any).fields;
          if (id && fields) {
            entries.push({ id, fields });
          }
        }
      }
    }

    return entries;
  }

  private normalizeFields(fields: any): Record<string, string> {
    if (!fields) return {};
    if (!Array.isArray(fields)) return fields as Record<string, string>;

    const result: Record<string, string> = {};
    for (let i = 0; i < fields.length; i += 2) {
      const key = fields[i];
      const value = fields[i + 1];
      if (key !== undefined) {
        result[String(key)] = value !== undefined ? String(value) : "";
      }
    }
    return result;
  }

  private noticeFromFields(fields: any): RealtimeNotice | null {
    const normalized = this.normalizeFields(fields);
    const seq = Number(normalized.seq);
    if (!Number.isFinite(seq)) return null;

    return {
      seq,
      resourceType: (normalized.resourceType || "collection") as any,
      resource: normalized.resource || "",
      operation: (normalized.operation || "update") as any,
    };
  }
}

export const redisStreamsAdapter = (options: RedisStreamsAdapterOptions) =>
  new RedisStreamsAdapter(options);
