/**
 * SPIKE — Production sandbox model (de-risk #1).
 *
 * A STANDALONE Deno HTTP service that runs UNTRUSTED TypeScript in a per-request
 * Deno Worker with scoped permissions. The main QUESTPIE app (Bun/Node) calls this
 * over HTTP via the `executor` adapter — the main app image needs NO Deno.
 *
 * Run:
 *   deno run --allow-net --allow-env=PORT --unstable-worker-options sandbox-server.ts
 *
 * Flags explained (these are the SERVICE's own permissions — guests get nothing
 * from them; each guest Worker is granted scoped perms separately, see below):
 *   --allow-net               the SERVICE needs net to bind the HTTP listener.
 *                             (Per-request guest net is granted PER-WORKER below,
 *                              NOT inherited from this flag — see permissions object.)
 *   --allow-env=PORT          the SERVICE reads only the PORT env var. Scoped, not broad.
 *   --unstable-worker-options REQUIRED in Deno 2.7 to pass `deno.permissions` to a Worker.
 *                             Without it: "Unstable API 'Worker.deno.permissions'."
 *
 * The service deliberately does NOT run with --allow-read / --allow-import / --allow-write /
 * --allow-run / --allow-ffi, and only a scoped --allow-env=PORT.
 * Each guest Worker gets its own scoped grants (net + import allowlist) and nothing else.
 *
 * Contract (POST /run):
 *   { source: string, capabilities: { net: string[], timeoutMs: number, memoryMb: number }, input: unknown }
 *   -> { ok: boolean, output?: unknown, logs: string[], error?: string, timedOut?: boolean, ms: number }
 */

interface Capabilities {
  net: string[]; // host[:port] allowlist, e.g. ["esm.sh:443"]
  timeoutMs: number; // hard wall-time; worker terminated on exceed
  memoryMb: number; // advisory only — see README "memory cap reality"
}

interface RunRequest {
  source: string;
  capabilities: Capabilities;
  input: unknown;
}

interface RunResult {
  ok: boolean;
  output?: unknown;
  logs: string[];
  error?: string;
  timedOut?: boolean;
  ms: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_TIMEOUT_MS = 30_000;

/**
 * Bootstrap wrapper that hosts the untrusted `source`.
 *
 * - Captures console.* into a logs[] buffer and ships it back with the result.
 * - Expects the guest `source` to `export default async function(input) {...}`
 *   (Val Town semantics: default export = the entry). We import the guest as a
 *   nested blob module so its top-level `import "https://esm.sh/..."` is governed
 *   by the SAME per-Worker import permission.
 * - Everything is wrapped in try/catch so a guest throw becomes a structured error,
 *   not a worker crash.
 */
function buildBootstrap(guestSource: string): string {
  // The guest module is embedded as its own blob so dynamic/static esm.sh imports
  // inside it resolve under the worker's `import` permission.
  const guestB64 = btoa(unescape(encodeURIComponent(guestSource)));
  return /* js */ `
const logs = [];
const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
for (const level of ["log", "error", "warn", "info"]) {
  console[level] = (...args) => {
    logs.push(level + ": " + args.map((a) => {
      try { return typeof a === "string" ? a : JSON.stringify(a); } catch { return String(a); }
    }).join(" "));
    orig[level](...args);
  };
}

self.onmessage = async (e) => {
  const input = e.data;
  try {
    const guestSrc = decodeURIComponent(escape(atob(${JSON.stringify(guestB64)})));
    const guestUrl = URL.createObjectURL(new Blob([guestSrc], { type: "application/typescript" }));
    const mod = await import(guestUrl);
    const entry = mod.default;
    if (typeof entry !== "function") {
      throw new Error("guest must 'export default' a function(input)");
    }
    const output = await entry(input);
    self.postMessage({ ok: true, output, logs });
  } catch (err) {
    self.postMessage({ ok: false, error: (err && err.message) ? err.message : String(err), logs });
  }
};
`;
}

function runInWorker(req: RunRequest): Promise<RunResult> {
  const started = performance.now();
  const timeoutMs = Math.min(Math.max(req.capabilities.timeoutMs || DEFAULT_TIMEOUT_MS, 1), MAX_TIMEOUT_MS);
  const allow = req.capabilities.net ?? [];

  const bootstrap = buildBootstrap(req.source);
  const bootUrl = URL.createObjectURL(new Blob([bootstrap], { type: "application/typescript" }));

  const worker = new Worker(bootUrl, {
    type: "module",
    // @ts-ignore — Deno-specific Worker option (requires --unstable-worker-options)
    deno: {
      permissions: {
        // Runtime fetch() allowlist. Empty array => no net at all.
        net: allow.length ? allow : false,
        // Module import allowlist (static + dynamic import of https://esm.sh/...).
        // VERIFIED: this is the ONLY way to grant scoped import inside a worker;
        // it does NOT inherit the parent's --allow-import. Same allowlist as net.
        import: allow.length ? allow : false,
        // Everything else hard-denied. VERIFIED: read/write/env/run/ffi => NotCapable.
        read: false,
        write: false,
        env: false,
        run: false,
        ffi: false,
        sys: false,
      },
    },
  });

  return new Promise<RunResult>((resolve) => {
    let settled = false;
    const finish = (r: Omit<RunResult, "ms">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { worker.terminate(); } catch { /* noop */ }
      URL.revokeObjectURL(bootUrl);
      resolve({ ...r, ms: Math.round(performance.now() - started) });
    };

    // HARD wall-time: terminate() forcibly stops the worker even mid-infinite-loop.
    const timer = setTimeout(() => {
      finish({ ok: false, timedOut: true, error: `wall-time exceeded (${timeoutMs}ms)`, logs: [] });
    }, timeoutMs);

    worker.onmessage = (e) => {
      const d = e.data ?? {};
      finish({ ok: !!d.ok, output: d.output, error: d.error, logs: d.logs ?? [] });
    };
    // A worker-level uncaught error (e.g. blocked import, syntax error in bootstrap).
    worker.onerror = (e) => {
      e.preventDefault?.();
      finish({ ok: false, error: e.message || "worker error", logs: [] });
    };
    worker.onmessageerror = () => {
      finish({ ok: false, error: "worker message (de)serialization error", logs: [] });
    };

    worker.postMessage(req.input);
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const port = Number(Deno.env.get("PORT") ?? 8787);

Deno.serve({ port, onListen: ({ port }) => console.log(`sandbox-server listening on :${port}`) }, async (request) => {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return jsonResponse({ ok: true, runtime: "deno", version: Deno.version.deno });
  }

  if (request.method === "POST" && url.pathname === "/run") {
    let req: RunRequest;
    try {
      req = (await request.json()) as RunRequest;
    } catch {
      return jsonResponse({ ok: false, error: "invalid JSON body" }, 400);
    }
    if (typeof req.source !== "string" || !req.capabilities) {
      return jsonResponse({ ok: false, error: "missing 'source' or 'capabilities'" }, 400);
    }
    const result = await runInWorker(req);
    return jsonResponse(result);
  }

  return jsonResponse({ ok: false, error: "not found" }, 404);
});
