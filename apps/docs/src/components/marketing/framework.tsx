import questpiePackage from "../../../../../packages/questpie/package.json";
import { CodeSample } from "./code";
import { HeroCodeRotator } from "./hero-code-rotator";
import { SnippetExplorer } from "./snippet-explorer";

const GITHUB_URL = "https://github.com/questpie/questpie";

const MODEL = `import { collection } from "#questpie/factories";

export const posts = collection("posts")
  .fields(({ f }) => ({
    title: f.text(255).required(),
    published: f.boolean().default(false),
    author: f.relation("user").required(),
  }))
  .access({ read: true });`;

const HERO_SNIPPETS = [
	{
		annotations: [
			{
				description:
					"Declares the fields that drive storage, validation and generated types.",
				match: ".fields",
			},
			{
				description:
					"Makes the field mandatory across writes, generated APIs and clients.",
				match: ".required",
			},
			{
				description: "Keeps authorization next to the model it protects.",
				match: ".access",
			},
		],
		code: MODEL,
		description:
			"Fields, relations and access rules become the shared contract for the database, API and client.",
		file: "collections/posts.ts",
		key: "model",
		label: "Model",
		mark: "4,5,6",
	},
	{
		annotations: [
			{
				description: "Validates the request before the handler runs.",
				match: ".schema",
			},
			{
				description:
					"Uses the same access boundary as the rest of the application.",
				match: ".access",
			},
			{
				description:
					"Receives typed input and collections through the application context.",
				match: ".handler",
			},
		],
		code: `export default route()
  .post()
  .schema(z.object({ title: z.string() }))
  .access(({ session }) => !!session?.user)
  .handler(async ({ input, collections }) => {
    const post = await collections.posts.create(input);
    return { id: post.id };
  });`,
		description:
			"Validated input and typed collections meet inside a route that is discovered from its file.",
		file: "routes/create-post.ts",
		key: "route",
		label: "Route",
		mark: "3,4,5,6,7",
	},
	{
		annotations: [
			{
				description: "Validates the payload before the job is accepted.",
				match: "schema:",
			},
			{
				description: "Injects typed services when the background job runs.",
				match: "handler:",
			},
			{
				description:
					"Uses the configured mail service without rebuilding the integration.",
				match: "email.send",
			},
		],
		code: `export default job({
  name: "daily-digest",
  schema: z.object({ recipient: z.email() }),
  handler: async ({ payload, email }) =>
    email.send({
      to: payload.recipient,
      subject: "Daily digest",
    }),
});`,
		description:
			"Background work receives a validated payload and the same typed services as the request path.",
		file: "jobs/daily-digest.ts",
		key: "job",
		label: "Job",
		mark: "3,4,5,6,7",
	},
] as const;

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
		code: `export default route()
  .post()
  .schema(z.object({ period: z.enum(["day", "week"]) }))
  .handler(async ({ input, collections }) => {
    const total = await collections.posts.count({});
    return { period: input.period, total };
  });`,
		file: "routes/post-stats.ts",
		key: "routes",
		title: "Routes",
	},
	{
		body: "React to collection changes without importing the generated app back into the files it discovers.",
		code: `.hooks({
  afterChange: async ({ data, operation, queue }) => {
    if (operation !== "create") return;
    await queue.notifyPost.publish({ postId: data.id });
  },
});`,
		file: "collections/posts.ts",
		key: "hooks",
		title: "Hooks",
	},
	{
		body: "Run work now, later or on a schedule with typed payloads and the same collections and services.",
		code: `export default job({
  name: "daily-digest",
  schema: z.object({}),
  handler: async ({ email }) => {
    await email.send({
      to: "team@example.com",
      subject: "Daily digest",
      html: "<p>The latest posts are ready.</p>",
    });
  },
  options: { cron: "0 8 * * *" },
});`,
		file: "jobs/daily-digest.ts",
		key: "jobs",
		title: "Jobs",
	},
	{
		body: "Give routes, hooks and jobs one typed dependency instead of rebuilding integrations in every handler.",
		code: `export default service({
  create: () => ({
    readingTime(content: string) {
      const words = content.trim().split(/\\s+/).length;
      return Math.max(1, Math.ceil(words / 200));
    },
  }),
});`,
		file: "services/editorial.ts",
		key: "services",
		title: "Services",
	},
] as const;

const PRODUCT_SURFACES = [
	{
		body: "Generate collection forms, list views and authentication-aware navigation from field metadata.",
		code: `import { adminModule } from "@questpie/admin/modules/admin";

export default [adminModule] as const;`,
		file: "server/modules.ts",
		key: "admin",
		title: "Admin",
	},
	{
		body: "Publish the machine-readable schema and a Scalar reference UI from the same application contract.",
		code: `import { openApiModule } from "@questpie/openapi";

export default [openApiModule] as const;

// /api/openapi.json
// /api/docs`,
		file: "server/modules.ts",
		key: "openapi",
		title: "OpenAPI",
	},
	{
		body: "Expose approved collection operations and routes as agent tools under the access rules already in the app.",
		code: `import { adminModule } from "@questpie/admin/modules/admin";
import { mcpModule } from "@questpie/mcp/modules/mcp";

export default [adminModule, mcpModule] as const;

// OAuth-gated endpoint: /api/mcp`,
		file: "server/modules.ts",
		key: "mcp",
		title: "MCP",
	},
] as const;

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

					<HeroCodeRotator items={HERO_SNIPPETS} />
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
							<CodeSample bare code={REST} lang="http" />
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
					<SnippetExplorer items={APPLICATION_PARTS} />
				</div>
			</section>

			<section className="band">
				<div className="wrap">
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
					<SnippetExplorer compact items={PRODUCT_SURFACES} />
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
