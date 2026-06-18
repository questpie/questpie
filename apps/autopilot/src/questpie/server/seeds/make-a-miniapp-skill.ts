import { seed } from "questpie/services";

/**
 * Seed: the `make-a-miniapp` SKILL (the concrete first skill artifact).
 *
 * Design: `.private/miniapps-v2-design.md` §8.6. A skill is a `kind:"skill"` /
 * `renderer:"markdown"` SKILL.md file in the unified `assets` store at
 * `company/skills/{skill-id}/SKILL.md`, plus L3 sibling files under the same dir.
 *
 * This skill is `status:"published"` (HUMAN-AUTHORED, not agent-self-authored), so
 * the run-start discovery (`lib/skill-discovery.ts`) injects its `{name,description}`
 * (L1) into every run; the agent loads the body (L2) + the L3 templates on demand
 * with the file-read tool.
 *
 * The SKILL.md frontmatter is parsed + validated by the write-time hook
 * (`collections/assets.ts` → `lib/skill-frontmatter.ts`) on seed, mirroring it into
 * `metadata.skill`. The body + L3 content is kept ACCURATE to the WS-5 `.app` bundle
 * conventions (`apps/app-resolver.ts`, `apps/actions-scan.ts`, `apps/manifest.ts`).
 *
 * Re-runnable: deletes this skill's `assets` rows by path and re-creates them on
 * every run, so `db:seed` overwrites in place.
 */

const SKILL_DIR = "company/skills/make-a-miniapp";
const SKILL_PATH = `${SKILL_DIR}/SKILL.md`;
const SERVER_TEMPLATE_PATH = `${SKILL_DIR}/server.template.ts`;
const MANIFEST_REFERENCE_PATH = `${SKILL_DIR}/manifest.reference.md`;
const JSX_CONVENTION_PATH = `${SKILL_DIR}/references/jsx-convention.md`;
const EXAMPLE_PATH = `${SKILL_DIR}/examples/social-scheduler.md`;

/**
 * The SKILL.md — L1 frontmatter (name + description = the trigger) + L2 body (the
 * lean, skimmable procedure). Detail lives in the L3 sibling files referenced here.
 */
const SKILL_BODY = `---
name: make-a-miniapp
description: Build a mini-app inside Autopilot — an executable file (server.ts opt-in actions + optional index.html/app.jsx UI) with an inline capability manifest, cron and/or named actions. Use when the user asks to create an automation, tool, scheduler, dashboard, or any in-Autopilot app that runs code or persists data.
version: 1.0.0
status: published
allowed_tools: [knowledge_read, knowledge_write, run_code]
references:
  - server.template.ts
  - manifest.reference.md
  - references/jsx-convention.md
  - examples/social-scheduler.md
---

# Make a mini-app

A mini-app is a \`.app\` FOLDER of files in the company file store — NOT a deploy.
The subtree \`company/apps/{appId}.app/\` IS the app; writable app data lives OUTSIDE
it at \`company/apps/{appId}/data/\`. There is no build step.

## Procedure

1. **Choose \`{appId}\`** — a lowercase DNS-label slug matching \`^[a-z0-9][a-z0-9-]*$\`
   (e.g. \`social-scheduler\`). It is interpolated into the file path AND the
   sandbox principal, so the charset is enforced — a bad id is rejected.

2. **Decide the shape.** Automation-only = 1 file (\`server.ts\`). With UI = add
   \`index.html\` + an \`app.jsx\` (no-build JSX, see \`references/jsx-convention.md\`).

3. **Write \`server.ts\`** (the REQUIRED entry — read \`server.template.ts\` for a full
   copy-paste skeleton). The module runs SANDBOXED and is loaded INTACT — it must
   NOT import anything from \`questpie\` (the host injects \`globalThis.questpie\`; there
   is no \`questpie/miniapp\` module). It MUST contain, as top-level exports:
   - \`export const manifest = { … }\` — the INLINE, default-deny capability scope.
     It is a STATIC object literal (no variables/calls — it is re-parsed without
     running your code on EVERY request). See \`manifest.reference.md\` for the axes.
   - the action handlers as plain async functions assigned to top-level \`const\`s:
     \`const status = async function (input) { … }\` (or \`async (input) => { … }\`).
   - \`export const actions = { … }\` — the OPT-IN HTTP surface. ONLY the keys of this
     object are callable at \`/api/apps/{appId}/{action}\`. An export NOT in this
     object is never HTTP-reachable (this is the security boundary — opt-in, never
     "every export").
   - optional \`export const cron = async function (input) { … }\` — a scheduled
     handler. Cron is inferred BY NAME (\`cron\` or \`cron\`-prefixed like \`cronDigest\`);
     it has NO HTTP exposure. \`export default\` is RESERVED (treated as cron, never an
     action).

   Reserved names you may NOT use as an action key or cron name: \`manifest\`,
   \`actions\`, \`cron\`, \`fetch\`, \`default\` — a collision FAILS CLOSED.

4. **Write the bundle to the store** under \`company/apps/{appId}.app/\` — one
   \`kind:"miniapp"\`, \`renderer:"miniapp"\` row per file (\`server.ts\`, and any
   \`index.html\`/\`app.jsx\`/\`assets/*\`). The \`.app\` subtree is guest-READ-ONLY.

5. **If it has UI**, add \`index.html\` (loads React + \`@babel/standalone\`, references
   \`app.jsx\`) and \`app.jsx\` (transpiled in-browser, NO build) — see
   \`references/jsx-convention.md\`. The host inlines them into a sandboxed iframe and
   exposes \`window.app.{action}(input)\` for the UI to call your actions.

6. **Persist app data** under \`company/apps/{appId}/data/**\` via the scoped
   \`questpie.files.{read,write,list}\` bindings from inside the app (your manifest
   must grant \`files.write\` for that subtree). Never write into the \`.app\` bundle.

7. **Grant only what you need.** Every capability axis is default-deny: an omitted
   axis grants nothing. Add \`net\`/\`import\` host allowlists, \`data.collections\`/
   \`data.stores\` grants, \`services\`/\`jobs\`/\`workflows\`, and \`timeoutMs\`/\`memoryMb\`
   bounds ONLY as the app actually requires them.

8. **Verify.** Invoke an action (\`POST /api/apps/{appId}/{action}\`) or trigger the
   schedule, then check the run links / the app's \`data/\` output.

## Worked example

\`examples/social-scheduler.md\` is a complete, runnable mini-app: an inline manifest
(net + files + a granted collection read), a \`status\` action, a \`cron\` that marks a
queued-posts file "sent", and the opt-in \`actions = { status }\` registry.
`;

/**
 * L3: a copy-paste `server.ts` skeleton. Kept faithful to the resolver contract
 * (inline static manifest + plain async handlers + opt-in `actions` + optional
 * cron; NO imports — the guest module is loaded intact and never imports `questpie`).
 */
const SERVER_TEMPLATE = `// {appId}.app/server.ts — a mini-app server entry skeleton.
//
// Runs SANDBOXED. The host injects \`globalThis.questpie\` (capability-scoped to your
// manifest) + the allowlisted \`fetch\`; you NEVER import anything (the module is
// loaded intact — there is no \`questpie/miniapp\` package). The manifest is re-parsed
// + re-validated WITHOUT running this file on every request, so it MUST be a static
// object literal.

// 1) INLINE capability manifest (default-deny; every axis optional). STATIC literal.
export const manifest = {
  name: "My App",
  capabilities: {
    // net: ["api.example.com"],           // fetch() host allowlist
    // import: ["esm.sh"],                  // remote module-import host allowlist
    files: {
      read: ["company/apps/{appId}.app/**", "company/apps/{appId}/data/**"],
      write: ["company/apps/{appId}/data/**"],
    },
    // data: { collections: { posts: ["read", "create"] }, stores: { mine: ["read", "write"] } },
    // services: ["someService"], jobs: ["someJob"], workflows: ["someFlow"],
    timeoutMs: 5000,
    memoryMb: 128,
  },
};

// 2) Action handlers — plain async functions, each assigned to a top-level const.
//    \`input\` is the (already-parsed) request body; validate it yourself if needed.
const ping = async function (input) {
  return { ok: true, echo: input && input.message };
};

// 3) Optional cron (inferred by name; NO HTTP exposure).
export const cron = async function (input) {
  // periodic work — e.g. read/write the app's data/ subtree via questpie.files.*
  return { ok: true };
};

// 4) OPT-IN HTTP surface: ONLY these keys are callable at /api/apps/{appId}/{action}.
export const actions = { ping };
`;

/** L3: the capability-manifest axis reference, derived from `apps/manifest.ts`. */
const MANIFEST_REFERENCE = `# Mini-app manifest reference

\`export const manifest = { name?, entry?, capabilities }\` is the INLINE,
default-deny capability scope. It is a STATIC object literal (no variables, calls,
spreads, or computed keys) — it is re-extracted from the AST and re-validated on
EVERY request WITHOUT executing your code. Every axis is OPTIONAL; an omitted axis
grants NOTHING.

## Top-level

- \`name?: string\` — display name only.
- \`entry?: string\` — server entry path relative to the \`.app\` root (default
  \`server.ts\`). No leading \`/\`, no \`..\` segment.
- \`capabilities\` — REQUIRED. The axes below.

## \`capabilities\` axes

| Axis | Shape | Grants |
|---|---|---|
| \`net\` | \`string[]\` (\`host[:port]\`) | runtime \`fetch()\` host allowlist |
| \`import\` | \`string[]\` (\`host[:port]\`) | remote module-import host allowlist |
| \`files\` | \`{ read?: string[]; write?: string[] }\` | file-store path globs (file-as-DB) |
| \`data.collections\` | \`{ [name]: ("read"\\|"create"\\|"update"\\|"delete")[] }\` | per-collection CRUD |
| \`data.globals\` | \`{ [name]: ("read"\\|"write")[] }\` | per-global access |
| \`data.stores\` | \`{ [store]: ("read"\\|"write")[] }\` | per-\`document_store\`-namespace access |
| \`services\` | \`string[]\` | callable service names |
| \`jobs\` | \`string[]\` | enqueueable job names |
| \`workflows\` | \`string[]\` | triggerable workflow names |
| \`timeoutMs\` | \`number\` (>0) | hard wall-clock timeout (ms) |
| \`memoryMb\` | \`number\` (>0) | hard memory bound (MB) |

## Rules

- Unknown verbs (e.g. a \`data.collections\` value other than read/create/update/
  delete) are REJECTED.
- \`files.read\` should include BOTH your bundle (\`company/apps/{appId}.app/**\`) and
  your data dir (\`company/apps/{appId}/data/**\`); \`files.write\` should be ONLY the
  data dir — you can never write into the \`.app\` bundle.
- Grant the MINIMUM: default-deny means you list exactly what the app uses.
`;

/** L3: the no-build JSX convention for the optional UI. */
const JSX_CONVENTION = `# No-build JSX convention (mini-app UI)

A mini-app UI is OPTIONAL. When present it is \`index.html\` + one or more \`*.jsx\`
files in the \`.app\` bundle — transpiled IN THE BROWSER via \`@babel/standalone\`, so
there is NO build step and no bundler.

## \`index.html\`

- Load React, ReactDOM, and \`@babel/standalone\` (from your \`import\`/\`net\`-allowed CDN).
- Include each \`*.jsx\` as \`<script type="text/babel" src="app.jsx"></script>\` (Babel
  compiles \`text/babel\` scripts at load).
- Provide a mount node (e.g. \`<div id="root"></div>\`).

## \`app.jsx\`

- Plain React using JSX; it is compiled client-side.
- Call your backend actions through the host bridge: \`window.app.{action}(input)\`
  returns a Promise of the action's result. The host proxies this to
  \`/api/apps/{appId}/{action}\` — the UI never fetches your backend directly.

## Runtime / security

- The host INLINES \`index.html\` + the \`*.jsx\` (as \`text/babel\` blocks) + the
  \`window.app\` bridge into a sandboxed iframe (\`sandbox="allow-scripts"\`, srcdoc,
  null origin). There is NO serving route.
- The iframe is NEVER \`allow-same-origin\`; auth is by token (not origin); a CSP is
  injected via \`<meta>\`. Keep the \`*.jsx\` reasonably sized (babel input is capped).
`;

/**
 * L3: a complete worked example. This mirrors the runnable `social-scheduler` dev
 * seed so the agent has a real, accurate reference.
 */
const EXAMPLE = `# Example: social-scheduler

A runnable mini-app. Bundle at \`company/apps/social-scheduler.app/\`; writable data
at \`company/apps/social-scheduler/data/\`.

## \`company/apps/social-scheduler.app/server.ts\`

The module is loaded INTACT and runs sandboxed — it imports NOTHING (no
\`questpie/miniapp\`); the host injects \`globalThis.questpie\` + the allowlisted
\`fetch\`. Handlers are plain async functions; the opt-in \`actions\` registry is the
HTTP surface.

\`\`\`ts
export const manifest = {
  name: "Social Scheduler",
  capabilities: {
    net: ["jsonplaceholder.typicode.com"],
    files: {
      read: [
        "company/apps/social-scheduler.app/**",
        "company/apps/social-scheduler/data/**",
      ],
      write: ["company/apps/social-scheduler/data/**"],
    },
    data: { collections: { projects: ["read"] } },
    timeoutMs: 5000,
    memoryMb: 128,
  },
};

const QUEUE_PATH = "company/apps/social-scheduler/data/queue.json";

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

// ACTION (opt-in below): GET|POST /api/apps/social-scheduler/status
async function status(input) {
  const queue = await readQueue();
  const res = await fetch("https://jsonplaceholder.typicode.com/todos/1");
  const todo = await res.json();
  return { ok: true, queueCount: queue.length, fetchedTitle: todo.title };
}

// CRON (inferred by name; not HTTP): mark queued posts "sent".
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

// OPT-IN HTTP surface — ONLY \`status\` is reachable; \`cron\` is scheduled-only;
// \`readQueue\` is an internal helper and is NOT HTTP-callable.
export const actions = { status };
\`\`\`

## \`company/apps/social-scheduler/data/queue.json\`

\`\`\`json
[
  { "id": "post-1", "channel": "twitter", "text": "…", "status": "scheduled" }
]
\`\`\`
`;

export default seed({
	id: "makeAMiniappSkill",
	description:
		"The make-a-miniapp SKILL (company/skills/make-a-miniapp/SKILL.md) + its L3 sibling files: server.template.ts, manifest.reference.md, references/jsx-convention.md, examples/social-scheduler.md.",
	category: "dev",
	async run({ services, collections, createContext, log }) {
		const ctx = await createContext({ accessMode: "system", locale: "en" });

		// Re-runnable: hard-delete prior rows for this skill, then re-create. `assets`
		// has no soft-delete, so the rows are physically removed (no unique-path
		// collision on re-create; the frontmatter mirror is re-asserted by the hook).
		await collections.assets.delete(
			{
				where: {
					path: {
						in: [
							SKILL_PATH,
							SERVER_TEMPLATE_PATH,
							MANIFEST_REFERENCE_PATH,
							JSX_CONVENTION_PATH,
							EXAMPLE_PATH,
						],
					},
				} as any,
			},
			ctx,
		);

		// The SKILL.md itself: kind:"skill" → the write-time validator parses its
		// frontmatter into metadata.skill (the L1 mirror discovery injects).
		log("Seeding make-a-miniapp SKILL.md...");
		await services.knowledgeResource.createTextResource({
			title: "Make a mini-app",
			path: SKILL_PATH,
			body: SKILL_BODY,
			scopeType: "company",
			kind: "skill",
			contentType: "text/markdown",
			renderer: "markdown",
			source: "human",
			sourceRef: "seed:make-a-miniapp",
			metadata: { seed: "makeAMiniappSkill" },
		});

		// L3 sibling files (kind:"document"): loaded on demand by the file-read tool.
		const l3: Array<{ title: string; path: string; body: string }> = [
			{
				title: "server.template.ts",
				path: SERVER_TEMPLATE_PATH,
				body: SERVER_TEMPLATE,
			},
			{
				title: "manifest.reference.md",
				path: MANIFEST_REFERENCE_PATH,
				body: MANIFEST_REFERENCE,
			},
			{
				title: "jsx-convention.md",
				path: JSX_CONVENTION_PATH,
				body: JSX_CONVENTION,
			},
			{ title: "social-scheduler.md", path: EXAMPLE_PATH, body: EXAMPLE },
		];
		for (const file of l3) {
			log(`Seeding make-a-miniapp L3: ${file.path}`);
			await services.knowledgeResource.createTextResource({
				title: file.title,
				path: file.path,
				body: file.body,
				scopeType: "company",
				kind: "document",
				contentType: file.path.endsWith(".ts")
					? "text/typescript"
					: "text/markdown",
				renderer: "markdown",
				source: "human",
				sourceRef: "seed:make-a-miniapp",
				metadata: { seed: "makeAMiniappSkill", skill: "make-a-miniapp" },
			});
		}

		log("make-a-miniapp skill seeded");
	},
});
