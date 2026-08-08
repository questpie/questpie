/* The framework page, band for band from ui_kits/marketing/framework.html.
 *
 * Every code sample here was checked against the repo rather than copied, and
 * most of them moved. The kit invented a fluent job builder, called the client's
 * method `list` on a collection accessor that does not exist, and offered an
 * install pair where one command has no such flag. A framework page that does
 * not compile is worse than no framework page: the first thing a reader does is
 * paste it.
 */
import questpiePackage from "../../../../../packages/questpie/package.json";
import { CodeSample } from "./code";

const GITHUB_URL = "https://github.com/questpie/questpie";

/* Verified against docs/getting-started/index.mdx (import path, .title) and
 * docs/concepts/collections.mdx, which chains .label() before .required(). */
const SCHEMA = `import { collection } from "#questpie/factories";

export const news = collection("news")
  .fields(({ f }) => ({
    title: f.text(255).label("Title").required(),
    content: f.richText(),
    isPublished: f.boolean().default(false),
  }))
  .title(({ f }) => f.title);`;

/* The kit listed four routes under a note claiming five. GET /:id was the one
 * missing; docs/client/sdk.mdx maps every method to its verb and path. */
const REST = `GET    /api/news
GET    /api/news/:id
POST   /api/news
PATCH  /api/news/:id
DELETE /api/news/:id`;

/* Was `client.news.list(...)` returning `{ data }`. The accessor is namespaced
 * under .collections, the method is find(), and sdk.mdx has a callout about the
 * envelope: "Read your rows off result.docs, never result itself." */
const CLIENT = `const { docs } = await client.collections.news.find({
  where: { isPublished: true },
  limit: 10,
});`;

/* The kit wrote `job("digest").every("1d").run(...)`. There is no such builder:
 * job() takes a definition object, and recurring work is options.cron. */
const JOB = `export default job({
  name: "digest",
  options: { cron: "0 8 * * *" },
  handler: async ({ collections, email }) => {
    await email.send(await buildDigest(collections.news));
  },
});`;

/* `bun add questpie drizzle-orm@beta zod` + `questpie generate --watch` was the
 * kit's pair. generate takes -c, --dry-run and --verbose — there is no --watch,
 * that command is `questpie dev`. The documented start is the scaffolder, which
 * installs dependencies and runs codegen for you. */
const START = `bunx create-questpie my-app
bun run dev`;

const ADMIN_TICKS = [
	"List with your labels and search",
	"Editor with the right control per field",
	"Versions, drafts and publish state",
];

const APP_PARTS = [
	{
		body: "Typed handlers receive the same collections, database and services.",
		title: "Routes",
	},
	{
		body: "Run work now, later or on a schedule. Keep retries in one place.",
		title: "Jobs",
	},
	{
		body: "Give hooks, routes and jobs one typed dependency.",
		title: "Services",
	},
	{
		body: "Add realtime, search, storage, mail and queues when you need them.",
		title: "Infrastructure",
	},
];

export function FrameworkPage() {
	return (
		<>
			<section className="band hero">
				<div className="wrap split">
					<div className="head">
						<p className="qp-aside">describe the data once</p>
						<h1 className="qp-display-xl">
							One schema. <em className="qp-hl">Everything else follows.</em>
						</h1>
						<p className="qp-lead">
							QUESTPIE derives the typed API, the admin, the jobs and the client
							from one definition. In your codebase, on your servers.
						</p>
						<div className="actions">
							<a className="btn p lg" href="/docs">
								Read the docs
							</a>
							<a
								className="btn o lg"
								href={GITHUB_URL}
								rel="noreferrer"
								target="_blank"
							>
								Star on GitHub
							</a>
						</div>
						{/* Bun 1.3+ and Postgres 15+ are the prerequisites the getting-started
						    page states; the kit said "Bun or Node 18+", which the template
						    does not target. */}
						<p className="qp-eyebrow">
							MIT · v{questpiePackage.version} · Bun 1.3+ · Postgres 15+
						</p>
					</div>

					<div className="hero-card">
						<div className="hero-card-head">
							<span className="qp-eyebrow">collections/news.ts</span>
							<span className="count">source of truth</span>
						</div>
						<CodeSample bare code={SCHEMA} mark="4,5" numbers />
					</div>
				</div>
			</section>

			<section className="band raised">
				<div className="wrap">
					<div className="head">
						<p className="qp-aside">derived, not written</p>
						<h2 className="qp-display-m">Four things you stop maintaining</h2>
					</div>
					<div
						className="grid2"
						style={{ gridAutoRows: "1fr", marginTop: "var(--space-8)" }}
					>
						<div className="card stack">
							<p className="qp-eyebrow">Typed REST</p>
							<CodeSample bare code={REST} lang="bash" />
							<p className="card-note">
								Five routes per collection, typed end to end.
							</p>
						</div>
						<div className="card stack">
							<p className="qp-eyebrow">Client</p>
							<CodeSample bare code={CLIENT} />
							<p className="card-note">
								Method names come from your collection names. No SDK to keep in
								step.
							</p>
						</div>
						<div className="card stack">
							<p className="qp-eyebrow">Admin</p>
							<div className="ticks">
								{ADMIN_TICKS.map((tick) => (
									<span key={tick}>
										<i />
										{tick}
									</span>
								))}
							</div>
							<p className="card-note">
								No layout file: the schema is the layout.{" "}
								<a href="/docs/admin">See the admin →</a>
							</p>
						</div>
						<div className="card stack">
							<p className="qp-eyebrow">Jobs</p>
							<CodeSample bare code={JOB} />
							{/* The kit promised "a run log". There is no built-in one — the
							    audit log is opt-in through logAuditEntry(). The cron schedule
							    is declarative and real, so it takes the third slot. */}
							<p className="card-note">
								Queue, retries and a cron schedule, from one file convention.
							</p>
						</div>
					</div>
				</div>
			</section>

			<section className="band">
				<div className="wrap split lean">
					<div className="head">
						<p className="qp-aside">one source of truth</p>
						<h2 className="qp-display-m">Change the model once</h2>
						<p>
							The same model types your database, API, admin and client. You do
							not copy a field or its rules into four files.
						</p>
					</div>
					<div className="derivation-flow">
						<div className="derivation-source">
							<span className="qp-eyebrow">Your model</span>
							<strong>Fields, access, hooks</strong>
						</div>
						<span aria-hidden="true" className="flow-arrow">
							→
						</span>
						<div className="derivation-outputs" role="list">
							{["Database", "Typed API", "Admin", "Client"].map((part) => (
								<span key={part} role="listitem">
									{part}
								</span>
							))}
						</div>
					</div>
				</div>
			</section>

			<hr className="rule" />

			<section className="band raised">
				<div className="wrap">
					<div className="head">
						<p className="qp-aside">the model is only the start</p>
						<h2 className="qp-display-m">
							Write the parts that make the app yours
						</h2>
						<p>
							QUESTPIE handles the repeated work. Your code holds the decisions.
						</p>
					</div>
					<div className="feature-list" role="list">
						{APP_PARTS.map((part) => (
							<div className="feature-item" key={part.title} role="listitem">
								<h3>{part.title}</h3>
								<p>{part.body}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			<section className="band">
				<div className="wrap split">
					<div className="head">
						<p className="qp-aside">your application stays yours</p>
						<h2 className="qp-display-m">Run it where you choose</h2>
						<p>
							QUESTPIE ships as open-source packages. Your code runs on your
							server. Your data stays in PostgreSQL.
						</p>
					</div>
					<div className="ownership-list" role="list">
						<div role="listitem">
							<span className="qp-eyebrow">Code</span>
							<strong>Your repository</strong>
						</div>
						<div role="listitem">
							<span className="qp-eyebrow">Data</span>
							<strong>Your PostgreSQL database</strong>
						</div>
						<div role="listitem">
							<span className="qp-eyebrow">Runtime</span>
							<strong>TanStack, Next, Hono or Elysia</strong>
						</div>
					</div>
				</div>
			</section>

			<section className="band" style={{ paddingBottom: "var(--space-16)" }}>
				<div className="wrap split">
					<div className="head">
						<p className="qp-aside">two commands</p>
						<h2 className="qp-display-m">Build the first app</h2>
						{/* "Adapter" is this product's word for a pluggable backend — email,
						    kv, queue, storage. The thing you pick here is the runtime, and
						    all four templates ship in create-questpie. */}
						<p>
							Pick your runtime: TanStack Start, Next, Hono or Elysia. The
							generator writes your typed app.
						</p>
						<div className="actions">
							<a className="btn p lg" href="/docs/learn/first-app">
								Create your first app
							</a>
							<a className="btn g lg" href="/docs/learn">
								See how QUESTPIE works
							</a>
						</div>
					</div>
					<CodeSample code={START} lang="bash" />
				</div>
			</section>
		</>
	);
}
