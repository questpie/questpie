import type { Client, ClientConfig } from "pg";
import type { RealtimeAdapter } from "../adapter.js";
import type { RealtimeChangeEvent, RealtimeNotice } from "../types.js";

export type PgNotifyAdapterOptions = {
  channel?: string;
  client?: Client;
  connection?: ClientConfig;
  connectionString?: string;
};

export class PgNotifyAdapter implements RealtimeAdapter {
  private client: Client | null = null;
  private clientConfig?: ClientConfig;
  private connectionString?: string;
  private channel: string;
  private listeners = new Set<(notice: RealtimeNotice) => void>();
  private started = false;
  private connected = false;
  private ownsClient = true;
  private notificationHandler?: (msg: { payload?: string | null }) => void;

  constructor(options: PgNotifyAdapterOptions = {}) {
    this.channel = options.channel ?? "questpie_realtime";

    if (!/^[a-zA-Z0-9_]+$/.test(this.channel)) {
      throw new Error(`Invalid pg notify channel name: "${this.channel}"`);
    }

    if (options.client) {
      this.client = options.client;
      this.ownsClient = false;
      return;
    }

    if (options.connection) {
      this.clientConfig = options.connection;
      return;
    }

    if (options.connectionString) {
      this.connectionString = options.connectionString;
      return;
    }
  }

  async start(): Promise<void> {
    if (this.started) return;
    const client = await this.ensureClient();
    await this.ensureConnected(client);
    await client.query(`LISTEN ${this.channel}`);
    this.notificationHandler = (msg) => {
      if (!msg.payload) return;
      let notice: RealtimeNotice | null = null;
      try {
        notice = JSON.parse(msg.payload) as RealtimeNotice;
      } catch {
        return;
      }
      for (const listener of this.listeners) {
        listener(notice);
      }
    };
    client.on("notification", this.notificationHandler as any);
    this.started = true;
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    const client = this.client;
    if (!client) return;

    if (this.notificationHandler) {
      client.off("notification", this.notificationHandler as any);
      this.notificationHandler = undefined;
    }

    try {
      await client.query(`UNLISTEN ${this.channel}`);
    } catch {
      // Ignore UNLISTEN failures during shutdown.
    }

    if (this.ownsClient) {
      try {
        await client.end();
      } finally {
        this.connected = false;
        this.client = null;
      }
    }
  }

  subscribe(handler: (notice: RealtimeNotice) => void): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  async notify(event: RealtimeChangeEvent): Promise<void> {
    const payload = JSON.stringify({
      seq: event.seq,
      resourceType: event.resourceType,
      resource: event.resource,
      operation: event.operation,
    });
    const client = await this.ensureClient();
    await this.ensureConnected(client);
    await client.query("select pg_notify($1, $2)", [this.channel, payload]);
  }

  private async ensureClient(): Promise<Client> {
    if (this.client) return this.client;
    const { Client: PgClient } = await import("pg");

    if (this.clientConfig) {
      this.client = new PgClient(this.clientConfig);
      return this.client;
    }

    if (this.connectionString) {
      this.client = new PgClient({ connectionString: this.connectionString });
      return this.client;
    }

    throw new Error(
      "PgNotifyAdapter requires a pg Client or connection config",
    );
  }

  private async ensureConnected(client: Client): Promise<void> {
    if (this.connected) return;

    try {
      await client.connect();
      this.connected = true;
      return;
    } catch (error) {
      const message = String((error as { message?: string })?.message || "");
      if (message.includes("already been connected")) {
        this.connected = true;
        return;
      }
      throw error;
    }
  }
}

export const pgNotifyAdapter = (options: PgNotifyAdapterOptions = {}) =>
  new PgNotifyAdapter(options);
