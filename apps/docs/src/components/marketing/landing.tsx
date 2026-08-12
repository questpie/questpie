import questpiePackage from "../../../../../packages/questpie/package.json";
import { CodeSample } from "./code";

const GITHUB_URL = "https://github.com/questpie/questpie";

const MODEL_SAMPLE = `import { collection } from "#questpie/factories";

export const posts = collection("posts")
  .fields(({ f }) => ({
    title: f.text(255).required(),
    published: f.boolean().default(false),
    author: f.relation("user").required(),
  }))
  .access({ read: true });`;

const CORE_OUTPUTS = [
	{
		detail: "Tables, relations and constraints are generated from the model.",
		title: "Database schema",
	},
	{
		detail:
			"CRUD endpoints and validation share the same field and access rules.",
		title: "Typed API",
	},
	{
		detail: "Queries and mutations know the exact shape of every collection.",
		title: "Typed client",
	},
];

const DEPTH = [
	{
		body: "Collection, field and operation rules live beside the data they protect. The same rules apply whether a request comes from REST, a hook or a job.",
		title: "One access model",
	},
	{
		body: "Routes, hooks, jobs and services receive typed collections, database and infrastructure services through the same application context.",
		title: "One application context",
	},
	{
		body: "Start with PostgreSQL. Add queues, storage, search, email or realtime through adapters when the application actually needs them.",
		title: "Infrastructure on purpose",
	},
];

function CoreOutputList() {
	return (
		<div className="generated-list">
			{CORE_OUTPUTS.map((output, index) => (
				<div className="generated-row" key={output.title}>
					<span className="qp-eyebrow">0{index + 1}</span>
					<div>
						<strong>{output.title}</strong>
						<p>{output.detail}</p>
					</div>
				</div>
			))}
		</div>
	);
}

export function Landing() {
	return (
		<>
			<section className="band hero home-hero">
				<div className="wrap split">
					<div className="head">
						<p className="qp-aside">server-first TypeScript framework</p>
						<h1 className="qp-display-xl">
							Define the model once.{" "}
							<em className="qp-hl">Keep the app in sync.</em>
						</h1>
						<p className="qp-lead">
							A collection holds fields, access rules and hooks in one file.
							QUESTPIE derives the PostgreSQL schema, typed REST API and typed
							client from it.
						</p>
						<div className="actions">
							<a className="btn p lg" href="/docs/learn/first-app">
								Create your first app
							</a>
							<a className="btn s lg" href="#model">
								Read how it works
							</a>
						</div>
						<p className="qp-eyebrow">
							MIT · TypeScript · PostgreSQL · self-hosted · v
							{questpiePackage.version}
						</p>
					</div>

					<div className="hero-card model-preview">
						<div className="hero-card-head">
							<span className="qp-eyebrow">collections/posts.ts</span>
							<span className="count">one source of truth</span>
						</div>
						<CodeSample bare code={MODEL_SAMPLE} mark="4,5,6" />
					</div>
				</div>
			</section>

			<section className="band editorial-band" id="model">
				<div className="wrap editorial-split">
					<div className="head">
						<p className="qp-aside">one definition, fewer contracts</p>
						<h2 className="qp-display-m">Change the field, not five places</h2>
						<p>
							Rename <code>title</code> and the server API and client types move
							with it. A stale property becomes an editor error instead of a
							production surprise.
						</p>
						<p>
							There is less to maintain because the contract is not copied into
							validators, endpoints and SDK types.
						</p>
					</div>
					<CoreOutputList />
				</div>
			</section>

			<section className="band raised">
				<div className="wrap">
					<div className="head">
						<p className="qp-aside">a focused core, modules when needed</p>
						<h2 className="qp-display-m">
							Use only the backend your app needs
						</h2>
						<p>
							The framework starts with the application model. Product surfaces
							and infrastructure stay explicit.
						</p>
					</div>

					<div className="contract-columns">
						<section>
							<p className="qp-eyebrow">Framework core</p>
							<h3>The backend contract</h3>
							<p>
								Collections, globals, REST, the typed client, access control,
								hooks, routes, jobs and services.
							</p>
						</section>
						<section>
							<p className="qp-eyebrow">Optional modules and adapters</p>
							<h3>Add the surfaces you need</h3>
							<p>
								Admin, OpenAPI, MCP, workflows, realtime, search, storage, email
								and queues.
							</p>
						</section>
					</div>
					<p className="contract-note">
						Run headless with Hono or Elysia, or add the admin UI with TanStack
						Start or Next.js.
					</p>
				</div>
			</section>

			<section className="band">
				<div className="wrap">
					<div className="head">
						<p className="qp-aside">beyond generated CRUD</p>
						<h2 className="qp-display-m">
							The rest of the backend speaks the same language
						</h2>
					</div>
					<div className="depth-list">
						{DEPTH.map((item, index) => (
							<section key={item.title}>
								<span className="qp-eyebrow">0{index + 1}</span>
								<div>
									<h3>{item.title}</h3>
									<p>{item.body}</p>
								</div>
							</section>
						))}
					</div>
				</div>
			</section>

			<hr className="rule" />

			<section className="band" id="products">
				<div className="wrap">
					<div className="head">
						<p className="qp-aside">
							open source foundation, practical product
						</p>
						<h2 className="qp-display-m">Build on QUESTPIE today</h2>
					</div>
					<div className="product-paths">
						<section>
							<p className="qp-eyebrow">Framework · available now</p>
							<h3>Own the application</h3>
							<p>
								Keep the code, database and deployment. QUESTPIE gives you the
								typed foundation without taking over your runtime.
							</p>
							<a href="/framework">Explore the framework →</a>
						</section>
						<section>
							<p className="qp-eyebrow">Autopilot · early access</p>
							<h3>See the foundation at work</h3>
							<p>
								Autopilot is a product built on QUESTPIE for shared work between
								people and agents. It is not required to use the framework.
							</p>
							<a href="/autopilot">Meet Autopilot →</a>
						</section>
					</div>
				</div>
			</section>

			<section className="band launch-band">
				<div className="wrap launch-split">
					<div className="head">
						<p className="qp-aside">your code, your data, your runtime</p>
						<h2 className="qp-display-l">Start with a working application</h2>
						<p>
							Choose TanStack Start, Next.js, Hono or Elysia. The generator
							installs the project, runs codegen and shows the next steps.
						</p>
						<div className="actions">
							<a className="btn p lg" href="/docs/learn/first-app">
								Create your first app
							</a>
							<a
								className="btn g lg"
								href={GITHUB_URL}
								rel="noreferrer"
								target="_blank"
							>
								View on GitHub
							</a>
						</div>
					</div>
					<CodeSample code="bunx create-questpie my-app" lang="bash" />
				</div>
			</section>
		</>
	);
}
