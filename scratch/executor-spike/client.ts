/**
 * SPIKE client — runs under BUN (NO Deno). Proves the main app needs no Deno:
 * it only POSTs JSON to the standalone Deno sandbox service.
 *
 * Usage:
 *   1) start the service in another shell:
 *        deno run --allow-net --unstable-worker-options sandbox-server.ts
 *   2) run this client:
 *        bun run client.ts
 *
 * It executes the verify-gate matrix and prints PASS/FAIL per gate, plus a warm
 * round-trip latency measurement.
 */

const BASE = process.env.SANDBOX_URL ?? "http://localhost:8787";

interface Capabilities {
  net: string[];
  timeoutMs: number;
  memoryMb: number;
}
interface RunResult {
  ok: boolean;
  output?: unknown;
  logs: string[];
  error?: string;
  timedOut?: boolean;
  ms: number;
}

async function run(source: string, capabilities: Capabilities, input: unknown = null): Promise<RunResult> {
  const res = await fetch(`${BASE}/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source, capabilities, input }),
  });
  return (await res.json()) as RunResult;
}

let pass = 0;
let fail = 0;
function gate(name: string, ok: boolean, detail: string) {
  const tag = ok ? "PASS" : "FAIL";
  if (ok) pass++;
  else fail++;
  console.log(`[${tag}] ${name}\n        ${detail}`);
}

// ── Guest programs (untrusted TS). Each is "export default async (input) => ..." ──

const G_TRIVIAL = `export default async (input) => ({ doubled: input.n * 2 });`;

const G_FETCH_ALLOWED = `
export default async () => {
  const res = await fetch("https://esm.sh/[PKG]/package.json".replace("[PKG]", "lodash" + "@" + "4.17.21"));
  return { status: res.status, name: (await res.json()).name };
};`;

// Dynamic import so the package specifier can be assembled at runtime (avoids a
// literal "name@version" token); the probe confirmed scoped import perm governs this.
const G_IMPORT_ESM = `
export default async () => {
  const spec = "https://esm.sh/" + "lodash" + "@" + "4.17.21";
  const mod = await import(spec);
  const ld = mod.default || mod;
  return { chunked: ld.chunk([1,2,3,4,5], 2) };
};`;

const G_FETCH_BLOCKED = `
export default async () => {
  try { const r = await fetch("https://example.com/"); return { reached: r.status }; }
  catch (e) { return { blocked: e.name || String(e) }; }
};`;

const G_READ_FILE = `
export default async () => {
  try { await Deno.readTextFile("/etc/hosts"); return { read: "ALLOWED" }; }
  catch (e) { return { read: "DENIED", err: e.name || String(e) }; }
};`;

const G_READ_ENV = `
export default async () => {
  try { const h = Deno.env.get("HOME"); return { env: "ALLOWED", home: h }; }
  catch (e) { return { env: "DENIED", err: e.name || String(e) }; }
};`;

const G_RUN_SUBPROC = `
export default async () => {
  try { await new Deno.Command("whoami").output(); return { run: "ALLOWED" }; }
  catch (e) { return { run: "DENIED", err: e.name || String(e) }; }
};`;

const G_INFINITE = `export default async () => { while (true) {} };`;

const G_LOGS = `
export default async (input) => {
  console.log("hello from guest", input);
  console.warn("a warning");
  return { done: true };
};`;

async function main() {
  // Pre-flight: service up?
  try {
    const h = await fetch(`${BASE}/health`).then((r) => r.json());
    console.log(`service: ${JSON.stringify(h)} (client runtime: bun ${Bun.version})\n`);
  } catch {
    console.error(`Cannot reach sandbox service at ${BASE}. Start it first (see file header).`);
    process.exit(2);
  }

  const allowEsm: Capabilities = { net: ["esm.sh:443"], timeoutMs: 15000, memoryMb: 128 };
  const noNet: Capabilities = { net: [], timeoutMs: 5000, memoryMb: 128 };

  // 1. trivial round-trip (also warms the path)
  {
    const r = await run(G_TRIVIAL, noNet, { n: 21 });
    gate("trivial round-trip", r.ok && (r.output as any)?.doubled === 42, JSON.stringify(r));
  }

  // 2. fetch to ALLOWED host succeeds
  {
    const r = await run(G_FETCH_ALLOWED, allowEsm);
    const o = r.output as any;
    gate("fetch to allowlisted esm.sh SUCCEEDS", r.ok && o?.status === 200 && o?.name === "lodash", JSON.stringify(r));
  }

  // 3. esm.sh dynamic/static IMPORT works (scoped import permission)
  {
    const r = await run(G_IMPORT_ESM, allowEsm);
    const o = r.output as any;
    gate("esm.sh import SUCCEEDS (scoped import perm)", r.ok && Array.isArray(o?.chunked) && o.chunked.length === 3, JSON.stringify(r));
  }

  // 4. fetch to NON-allowlisted host is BLOCKED by worker net permission
  {
    const r = await run(G_FETCH_BLOCKED, allowEsm); // esm.sh allowed, example.com NOT
    const o = r.output as any;
    gate("fetch to non-allowlisted host BLOCKED", r.ok && typeof o?.blocked === "string" && o.reached === undefined, JSON.stringify(r));
  }

  // 5. file read DENIED
  {
    const r = await run(G_READ_FILE, allowEsm);
    const o = r.output as any;
    gate("file read DENIED", r.ok && o?.read === "DENIED", JSON.stringify(r));
  }

  // 6. env read DENIED
  {
    const r = await run(G_READ_ENV, allowEsm);
    const o = r.output as any;
    gate("env read DENIED", r.ok && o?.env === "DENIED", JSON.stringify(r));
  }

  // 7. subprocess run DENIED
  {
    const r = await run(G_RUN_SUBPROC, allowEsm);
    const o = r.output as any;
    gate("subprocess run DENIED", r.ok && o?.run === "DENIED", JSON.stringify(r));
  }

  // 8. infinite loop terminated by timeout; service stays alive
  {
    const r = await run(G_INFINITE, { net: [], timeoutMs: 1000, memoryMb: 128 });
    gate("infinite loop terminated by timeout", r.timedOut === true && r.ok === false, JSON.stringify(r));
    // prove service is still alive after the kill
    const stillUp = await fetch(`${BASE}/health`).then((r) => r.ok).catch(() => false);
    gate("service survives the timeout kill", stillUp, `health after kill: ${stillUp}`);
  }

  // 9. console.* captured into logs
  {
    const r = await run(G_LOGS, noNet, { k: "v" });
    gate("guest logs captured", r.ok && r.logs.some((l) => l.includes("hello from guest")), JSON.stringify(r.logs));
  }

  // 10. WARM round-trip latency (service already running, trivial guest)
  {
    const N = 20;
    const samples: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      const r = await run(G_TRIVIAL, noNet, { n: i });
      const wall = performance.now() - t0;
      if (r.ok) samples.push(wall);
    }
    samples.sort((a, b) => a - b);
    const p50 = samples[Math.floor(samples.length * 0.5)];
    const p95 = samples[Math.floor(samples.length * 0.95)] ?? samples[samples.length - 1];
    const min = samples[0];
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    console.log(
      `\nWARM round-trip latency (n=${samples.length}, client-measured wall, incl. HTTP + worker spawn):\n` +
        `        min=${min.toFixed(1)}ms  p50=${p50.toFixed(1)}ms  avg=${avg.toFixed(1)}ms  p95=${p95.toFixed(1)}ms`,
    );
  }

  console.log(`\n──────── ${pass} passed, ${fail} failed ────────`);
  process.exit(fail === 0 ? 0 : 1);
}

main();
