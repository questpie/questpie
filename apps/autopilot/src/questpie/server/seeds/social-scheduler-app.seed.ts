import { seed } from "questpie/services";

/**
 * DEV seed: a runnable `social-scheduler` mini-app (in the `assets` file store).
 *
 * v2 (★ RESOLVED): the mini-app is a `.app` FOLDER. The bundle lives under
 * `company/apps/social-scheduler.app/` (guest-READ-ONLY: `server.ts` with the
 * INLINE manifest + the opt-in `actions` registry + cron). Its WRITABLE data
 * lives OUTSIDE the bundle at `company/apps/social-scheduler/data/`. The M3 app
 * resolver (`apps/app-resolver.ts`) reads the `.app` bundle + inline manifest +
 * the `actions` registry, and the M4 action runner / M5 cron runner run it in the
 * SANDBOXED executor against the real bindings broker. This drives a live backend
 * e2e of the mini-app runtime — it exercises the REAL paths:
 *   - net egress allowlist (`fetch` to jsonplaceholder),
 *   - files read/write/list via the capability-scoped `questpie.files.*`
 *     bindings (clamped host-side: read the bundle + data, write data only),
 *   - a granted collection read via `questpie.collections.projects.find` (the G2
 *     non-privileged principal + G3 relation guard).
 *
 * `projects` is the granted collection: it is populated by the
 * `autopilotDemoProductData` dev seed, has NO `.access()` rule (so the default
 * "require session" applies and the runner's synthesized authenticated
 * app-principal can read it), and the guest query passes no `where`/`orderBy`
 * (so the relation guard is a no-op).
 *
 * Re-runnable: deletes this app's `assets` entries by path and re-creates them on
 * every run, so `db:seed` overwrites in place.
 */

const APP_ID = "social-scheduler";
const BUNDLE_PREFIX = `company/apps/${APP_ID}.app`;
const DATA_PREFIX = `company/apps/${APP_ID}/data`;
const ENTRY_PATH = `${BUNDLE_PREFIX}/server.ts`;
const INDEX_PATH = `${BUNDLE_PREFIX}/index.html`;
const APP_JSX_PATH = `${BUNDLE_PREFIX}/app.jsx`;
const QUEUE_PATH = `${DATA_PREFIX}/queue.json`;

/**
 * `{appId}.app/server.ts` — the UNTRUSTED guest module.
 *
 * Loaded by the runner via a `data:` import, so a named `actions` entry (the HTTP
 * surface) and `export const cron` (the scheduled handler) are selected by name.
 * The capability `manifest` is declared INLINE (re-validated every run); the HTTP
 * surface is the OPT-IN `export const actions = { … }` registry. Uses ONLY the
 * injected `globalThis.questpie` bindings + the allowlisted `fetch` — it never
 * imports the app.
 */
const SERVER_SOURCE = `// social-scheduler mini-app — runs SANDBOXED via the mini-app runtime.
// The host injects \`globalThis.questpie\` (capability-scoped); we never import the app.

// INLINE capability manifest (re-validated against appManifestSchema every run).
export const manifest = {
  name: "Social Scheduler",
  capabilities: {
    net: ["esm.sh", "jsonplaceholder.typicode.com"],
    files: {
      read: ["company/apps/social-scheduler.app/**", "company/apps/social-scheduler/data/**"],
      write: ["company/apps/social-scheduler/data/**"],
    },
    data: { collections: { projects: ["read"] } },
    timeoutMs: 5000,
    memoryMb: 128,
  },
};

const QUEUE_PATH = "company/apps/social-scheduler/data/queue.json";
const LAST_RUN_PATH = "company/apps/social-scheduler/data/last-run.json";
const DATA_DIR = "company/apps/social-scheduler/data";

/** Read the queue.json array (returns [] when absent or unparseable). */
async function readQueue() {
  const rec = await questpie.files.read({ path: QUEUE_PATH });
  if (!rec || typeof rec.body !== "string") return [];
  try {
    const parsed = JSON.parse(rec.body);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ACTION: GET|POST /api/apps/social-scheduler/status (opt-in via the registry below).
async function status(input) {
  const queue = await readQueue();

  // List the app's own data dir via the scoped bindings.
  const listed = await questpie.files.list({ path: DATA_DIR });
  const dataFiles = Array.isArray(listed) ? listed.map((e) => e.path) : [];

  // Query a granted collection (non-privileged principal, no relation refs).
  // We ALWAYS attempt this to exercise the collection binding + show the
  // access boundary, but a denial must NOT abort the run — record it and
  // keep going through the rest of the app's paths.
  let sample = null;
  let projectsAccess = "ok";
  try {
    const projectsResult = await questpie.collections.projects.find({
      limit: 1,
    });
    const projectDocs =
      projectsResult && Array.isArray(projectsResult.docs)
        ? projectsResult.docs
        : [];
    sample =
      projectDocs.length > 0
        ? { id: projectDocs[0].id, name: projectDocs[0].name }
        : null;
  } catch (err) {
    sample = null;
    projectsAccess = "denied: " + String((err && err.message) || err);
  }

  // Allowlisted egress.
  const res = await fetch("https://jsonplaceholder.typicode.com/todos/1");
  const todo = await res.json();
  const fetchedTitle = todo && typeof todo.title === "string" ? todo.title : null;

  // Write a run marker back into the app's writable subtree.
  await questpie.files.write({
    path: LAST_RUN_PATH,
    title: "Last run",
    content: JSON.stringify(
      { at: new Date().toISOString(), queueCount: queue.length, fetchedTitle },
      null,
      2,
    ),
  });

  return {
    ok: true,
    queueCount: queue.length,
    dataFiles,
    sample,
    fetchedTitle,
    projectsAccess,
  };
}

// CRON: scheduled handler — marks queued posts "sent" and writes the queue back.
export const cron = async function (input) {
  const queue = await readQueue();
  let sent = 0;
  const updated = queue.map((post) => {
    if (post && post.status !== "sent") {
      sent += 1;
      return { ...post, status: "sent", sentAt: new Date().toISOString() };
    }
    return post;
  });

  await questpie.files.write({
    path: QUEUE_PATH,
    title: "Post queue",
    content: JSON.stringify(updated, null, 2),
  });

  return { ok: true, total: queue.length, sent };
};

// OPT-IN HTTP surface: the ONLY actions reachable at /api/apps/{appId}/{action}.
// \`status\` is callable; \`cron\` is inferred-by-name (scheduled, NOT HTTP); the
// internal \`readQueue\` helper is NOT in the registry → NOT HTTP-callable.
export const actions = { status };
`;

/**
 * `index.html` — the UI shell. The KnowledgeHost host-controls the load order: it
 * inlines the host-fixed React/ReactDOM/@babel/standalone CDN + the `window.app`
 * bridge, then this shell's BODY markup, then the `*.jsx` files in the order this
 * shell declares them via `<script type="text/babel" src="…">` (§6). The shell's
 * own `<script>` tags are stripped by the host (scripts come from the CDN list +
 * the bundle's jsx only); the `src="app.jsx"` here is used ONLY to sequence the
 * jsx load order.
 */
const INDEX_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /></head>
  <body>
    <div id="root"></div>
    <script type="text/babel" data-presets="env,react" src="app.jsx"></script>
  </body>
</html>`;

/**
 * `app.jsx` — the no-build UI entry (§6 convention): NO ES imports; pulls hooks off
 * the global \`React\`; calls the injected \`window.app.status()\` bridge; publishes
 * \`App\` onto \`window\` and mounts it. This is the component the live e2e exercises —
 * clicking "Run status" round-trips \`window.app.status()\` → the parent's bridge →
 * \`POST /api/apps/social-scheduler/status\` → the Deno sandbox → back into the frame.
 */
const APP_JSX = `const { useState, useCallback } = React;

function App() {
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // window.app.<action> is injected by the KnowledgeHost bridge.
      const out = await window.app.status({});
      setResult(out);
    } catch (err) {
      setError(String((err && err.message) || err));
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 16, color: "#111" }}>
      <h2 style={{ margin: "0 0 12px" }}>Social Scheduler</h2>
      <button
        data-testid="run-status"
        onClick={run}
        disabled={loading}
        style={{
          padding: "8px 14px",
          fontSize: 14,
          cursor: loading ? "default" : "pointer",
          border: "1px solid #ccc",
          borderRadius: 6,
          background: loading ? "#eee" : "#fff",
        }}
      >
        {loading ? "Running…" : "Run status"}
      </button>
      {error ? (
        <pre data-testid="status-error" style={{ color: "#b00", marginTop: 12 }}>
          {error}
        </pre>
      ) : null}
      {result ? (
        <pre
          data-testid="status-result"
          style={{
            marginTop: 12,
            padding: 12,
            background: "#f6f6f6",
            borderRadius: 6,
            fontSize: 12,
            overflow: "auto",
          }}
        >
          {JSON.stringify(result, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

Object.assign(window, { App });

const rootEl = document.getElementById("root");
if (rootEl && window.ReactDOM) {
  // React 18 UMD exposes ReactDOM.createRoot.
  ReactDOM.createRoot(rootEl).render(<App />);
}`;

/** Initial queue.json — a few scheduled "posts". */
const QUEUE = [
	{
		id: "post-1",
		channel: "twitter",
		text: "Shipping the new Knowledge mini-app runtime this week.",
		scheduledAt: "2026-06-10T09:00:00.000Z",
		status: "scheduled",
	},
	{
		id: "post-2",
		channel: "linkedin",
		text: "How we sandbox untrusted app code with a process-per-request Deno fleet.",
		scheduledAt: "2026-06-11T14:30:00.000Z",
		status: "scheduled",
	},
	{
		id: "post-3",
		channel: "mastodon",
		text: "Mini-apps are just files in Knowledge. No deploy step.",
		scheduledAt: "2026-06-12T17:00:00.000Z",
		status: "scheduled",
	},
];

export default seed({
	id: "socialSchedulerApp",
	description:
		"Dev mini-app (social-scheduler) for the mini-app runtime e2e: a .app bundle (server.ts with inline manifest + opt-in actions + cron) and a seed queue.json.",
	category: "dev",
	async run({ services, collections, createContext, log }) {
		const ctx = await createContext({ accessMode: "system", locale: "en" });

		// Re-runnable: hard-delete any prior rows for this app's entries by path,
		// then re-create them below. This lets `db:seed` overwrite on re-run (the
		// server/queue bodies + renderers are re-asserted by the
		// `createTextResource` calls). `assets` has no soft-delete, so the rows are
		// physically removed — no unique-path collision on re-create.
		await collections.assets.delete(
			// The unified `assets` row type collapses to `{}` for consumers
			// (admin-module + app intersection in codegen), so the `where` is cast.
			{
				where: {
					path: { in: [ENTRY_PATH, INDEX_PATH, APP_JSX_PATH, QUEUE_PATH] },
				} as any,
			},
			ctx,
		);

		// The `.app` bundle's server.ts: the INLINE manifest + the opt-in `actions`
		// registry + cron live here (no separate manifest.json). `kind:"miniapp"` +
		// `renderer:"miniapp"` mark it for the KnowledgeHost iframe (M7).
		log("Seeding social-scheduler .app bundle server entry...");
		await services.knowledgeResource.createTextResource({
			title: "Social Scheduler server entry",
			path: ENTRY_PATH,
			body: SERVER_SOURCE,
			scopeType: "company",
			kind: "miniapp",
			contentType: "text/typescript",
			renderer: "miniapp",
			source: "system",
			sourceRef: `seed:${APP_ID}`,
			metadata: { seed: "socialSchedulerApp", app: APP_ID },
		});

		// The `.app` bundle's UI shell + entry component (no-build JSX, §6). These
		// give the KnowledgeHost a real UI to inline + run in the browser, so the
		// `window.app.status()` bridge round-trip is exercised end-to-end. Both are
		// `kind:"miniapp"` so opening ANY bundle row mounts the host for the app.
		log("Seeding social-scheduler .app UI shell...");
		await services.knowledgeResource.createTextResource({
			title: "Social Scheduler UI shell",
			path: INDEX_PATH,
			body: INDEX_HTML,
			scopeType: "company",
			kind: "miniapp",
			contentType: "text/html",
			renderer: "miniapp",
			source: "system",
			sourceRef: `seed:${APP_ID}`,
			metadata: { seed: "socialSchedulerApp", app: APP_ID },
		});

		log("Seeding social-scheduler .app UI component...");
		await services.knowledgeResource.createTextResource({
			title: "Social Scheduler UI component",
			path: APP_JSX_PATH,
			body: APP_JSX,
			scopeType: "company",
			kind: "miniapp",
			contentType: "text/jsx",
			renderer: "miniapp",
			source: "system",
			sourceRef: `seed:${APP_ID}`,
			metadata: { seed: "socialSchedulerApp", app: APP_ID },
		});

		log("Seeding social-scheduler mini-app queue...");
		await services.knowledgeResource.createTextResource({
			title: "Post queue",
			path: QUEUE_PATH,
			body: JSON.stringify(QUEUE, null, 2),
			scopeType: "company",
			kind: "document",
			contentType: "application/json",
			renderer: "json",
			source: "system",
			sourceRef: `seed:${APP_ID}`,
			metadata: { seed: "socialSchedulerApp", app: APP_ID },
		});

		log("social-scheduler mini-app seeded");
	},
});
