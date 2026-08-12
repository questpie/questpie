import questpiePackage from "../../../../../packages/questpie/package.json";
import { CodeSample } from "./code";

const GITHUB_URL = "https://github.com/questpie/questpie";

const MODEL = `import { collection } from "#questpie/factories";

export const posts = collection("posts")
  .fields(({ f }) => ({
    title: f.text(255).required(),
    published: f.boolean().default(false),
    author: f.relation("user").required(),
  }))
  .access({ read: true });`;

const REST = `GET    /api/posts
GET    /api/posts/:id
POST   /api/posts
PATCH  /api/posts/:id
DELETE /api/posts/:id`;

const CLIENT = `const { docs } = await client.collections.posts.find({
  where: { published: true },
  with: { author: true },
});`;

const APPLICATION_PARTS = [
	{
		body: "Write type-safe endpoints beside the model. Handlers receive the application context and validated input.",
		title: "Routes for product logic",
	},
	{
		body: "React to collection changes without importing the generated app back into the files it discovers.",
		title: "Hooks for side effects",
	},
	{
		body: "Run work now, later or on a schedule with typed payloads and the same collections and services.",
		title: "Jobs for background work",
	},
	{
		body: "Give routes, hooks and jobs one typed dependency instead of rebuilding integrations in every handler.",
		title: "Services for shared capabilities",
	},
];

const START = `bunx create-questpie my-app
bun run dev`;

export function FrameworkPage() {
	return (
		<>
			<section className="band hero">
				<div className="wrap split">
					<div className="head">
						<p className="qp-aside">the backend contract in TypeScript</p>
						<h1 className="qp-display-xl">
							Model the application.{" "}
							<em className="qp-hl">Keep its parts aligned.</em>
						</h1>
						<p className="qp-lead">
							QUESTPIE turns collections into a PostgreSQL schema, typed REST
							API and typed client. Then it gives your routes, hooks and jobs
							the same application context.
						</p>
						<div className="actions">
							<a className="btn p lg" href="/docs/learn/first-app">
								Create your first app
							</a>
							<a
								className="btn o lg"
								href={GITHUB_URL}
								rel="noreferrer"
								target="_blank"
							>
								View on GitHub
							</a>
						</div>
						<p className="qp-eyebrow">
							MIT · v{questpiePackage.version} · Bun 1.3+ · PostgreSQL 15+
						</p>
					</div>

					<div className="hero-card model-preview">
						<div className="hero-card-head">
							<span className="qp-eyebrow">collections/posts.ts</span>
							<span className="count">one source of truth</span>
						</div>
						<CodeSample bare code={MODEL} mark="4,5,6" numbers />
					</div>
				</div>
			</section>

			<section className="band editorial-band">
				<div className="wrap">
					<div className="head">
						<p className="qp-aside">a contract you can inspect</p>
						<h2 className="qp-display-m">The useful output is already typed</h2>
						<p>
							The model is not a separate schema language. It stays in the same
							TypeScript project as the code that uses it.
						</p>
					</div>

					<div className="code-contract">
						<section>
							<p className="qp-eyebrow">Five REST endpoints per collection</p>
							<CodeSample bare code={REST} lang="bash" />
						</section>
						<section>
							<p className="qp-eyebrow">A client shaped by your model</p>
							<CodeSample bare code={CLIENT} />
						</section>
					</div>
				</div>
			</section>

			<section className="band raised">
				<div className="wrap">
					<div className="head">
						<p className="qp-aside">the framework does not stop at CRUD</p>
						<h2 className="qp-display-m">Your application logic has a home</h2>
						<p>
							File convention removes wiring. Typed context keeps the pieces
							connected without making them depend on one another.
						</p>
					</div>
					<div className="depth-list">
						{APPLICATION_PARTS.map((part, index) => (
							<section key={part.title}>
								<span className="qp-eyebrow">0{index + 1}</span>
								<div>
									<h3>{part.title}</h3>
									<p>{part.body}</p>
								</div>
							</section>
						))}
					</div>
				</div>
			</section>

			<section className="band">
				<div className="wrap editorial-split">
					<div className="head">
						<p className="qp-aside">interfaces are modules, not assumptions</p>
						<h2 className="qp-display-m">Add the surface your users need</h2>
						<p>
							The core owns the model and HTTP contract. Admin, OpenAPI and MCP
							read that contract through explicit modules.
						</p>
						<p>
							Run Hono or Elysia as a headless backend. Use TanStack Start or
							Next.js when the application needs the generated admin.
						</p>
					</div>
					<div className="generated-list">
						<div className="generated-row">
							<span className="qp-eyebrow">01</span>
							<div>
								<strong>Admin</strong>
								<p>Forms and collection views from field metadata.</p>
							</div>
						</div>
						<div className="generated-row">
							<span className="qp-eyebrow">02</span>
							<div>
								<strong>OpenAPI</strong>
								<p>A machine-readable API description and Scalar UI.</p>
							</div>
						</div>
						<div className="generated-row">
							<span className="qp-eyebrow">03</span>
							<div>
								<strong>MCP</strong>
								<p>
									Explicit tools for agents, backed by the same access model.
								</p>
							</div>
						</div>
					</div>
				</div>
			</section>

			<section className="band raised">
				<div className="wrap editorial-split">
					<div className="head">
						<p className="qp-aside">your application stays yours</p>
						<h2 className="qp-display-m">Choose every runtime boundary</h2>
						<p>
							The packages are open source. The application stays in your
							repository, runs on your server and stores data in PostgreSQL.
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
							<strong>TanStack, Next.js, Hono or Elysia</strong>
						</div>
					</div>
				</div>
			</section>

			<section className="band launch-band">
				<div className="wrap launch-split">
					<div className="head">
						<p className="qp-aside">from empty directory to typed backend</p>
						<h2 className="qp-display-l">Build the first application</h2>
						<p>
							Pick a runtime. The generator installs the project, runs codegen
							and shows the next steps.
						</p>
						<div className="actions">
							<a className="btn p lg" href="/docs/learn/first-app">
								Create your first app
							</a>
							<a className="btn g lg" href="/docs/learn">
								Understand the model
							</a>
						</div>
					</div>
					<CodeSample code={START} lang="bash" />
				</div>
			</section>
		</>
	);
}
