import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeWindow } from "./CodeWindow";

const frameworks = {
	hono: {
		title: "Hono",
		code: `import { Hono } from "hono"
import { questpieHono } from "@questpie/hono"
import { cms } from "./cms"

const app = new Hono()
  .route("/cms", questpieHono(cms))

export default {
  port: 3000,
  fetch: app.fetch,
}`,
	},
	elysia: {
		title: "Elysia",
		code: `import { Elysia } from "elysia"
import { questpieElysia } from "@questpie/elysia"
import { cms } from "./cms"

const app = new Elysia()
  .use(questpieElysia(cms, { basePath: "/cms" }))
  .listen(3000)

console.log("Server running on http://localhost:3000")`,
	},
	next: {
		title: "Next.js",
		code: `// app/api/cms/[...cms]/route.ts
import { cms } from "@/lib/cms"
import { questpieNextRouteHandlers } from "@questpie/next"

export const { GET, POST, PATCH, DELETE } = questpieNextRouteHandlers(cms)`,
	},
	tanstack: {
		title: "TanStack Start",
		code: `// routes/api/cms/$.ts
import { createAPIFileRoute } from "@tanstack/start/api"
import { questpieStartHandlers } from "@questpie/tanstack-start"
import { cms } from "@/server/cms"

export const Route = createAPIFileRoute("/api/cms/$")({
  ...questpieStartHandlers(cms),
})`,
	},
};

export function Frameworks() {
	return (
		<section className="py-24 border-t border-border/50">
			<div className="w-full max-w-7xl mx-auto px-4 text-center">
				<h2 className="font-mono text-sm tracking-[0.2em] uppercase text-primary mb-4">
					Framework Adapters
				</h2>
				<h3 className="text-3xl font-bold mb-6">One Backend, Any Framework</h3>
				<p className="text-muted-foreground max-w-2xl mx-auto mb-12">
					Define your CMS once, run it anywhere. Native adapters for the most
					popular modern frameworks. All follow the same HTTP standard - swap
					anytime.
				</p>

				<div className="max-w-3xl mx-auto">
					<Tabs defaultValue="hono">
						<div className="flex justify-center mb-8">
							<TabsList>
								<TabsTrigger value="hono">Hono</TabsTrigger>
								<TabsTrigger value="elysia">Elysia</TabsTrigger>
								<TabsTrigger value="next">Next.js</TabsTrigger>
								<TabsTrigger value="tanstack">TanStack Start</TabsTrigger>
							</TabsList>
						</div>

						{Object.entries(frameworks).map(([key, data]) => (
							<TabsContent key={key} value={key} className="mt-0">
								<CodeWindow
									title={`${key}-server.ts`}
									className="shadow-2xl shadow-primary/10"
								>
									{data.code}
								</CodeWindow>
							</TabsContent>
						))}
					</Tabs>

					<p className="text-sm text-muted-foreground mt-8">
						Learn more:{" "}
						<a
							href="https://orm.drizzle.team/"
							className="text-primary hover:underline"
						>
							Drizzle ORM
						</a>
						{" | "}
						<a
							href="https://www.better-auth.com/"
							className="text-primary hover:underline"
						>
							Better Auth
						</a>
						{" | "}
						<a
							href="https://github.com/timgit/pg-boss"
							className="text-primary hover:underline"
						>
							pg-boss
						</a>
						{" | "}
						<a
							href="https://flydrive.dev/"
							className="text-primary hover:underline"
						>
							Flydrive
						</a>
					</p>
				</div>
			</div>
		</section>
	);
}
