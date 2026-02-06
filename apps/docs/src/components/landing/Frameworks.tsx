import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeWindow } from "./CodeWindow";

const frameworks = {
  hono: {
    title: "Hono",
    code: `import { Hono } from "hono"
import { questpieHono } from "@questpie/hono"
import { app } from "./app"

const server = new Hono()
  .route("/api", questpieHono(app))

export default {
  port: 3000,
  fetch: server.fetch,
}`,
  },
  elysia: {
    title: "Elysia",
    code: `import { Elysia } from "elysia"
import { questpieElysia } from "@questpie/elysia"
import { app } from "./app"

const server = new Elysia()
  .use(questpieElysia(app, { basePath: "/api" }))
  .listen(3000)

console.log("Server running on http://localhost:3000")`,
  },
  next: {
    title: "Next.js",
    code: `// app/api/[...questpie]/route.ts
import { app } from "@/lib/app"
import { questpieNextRouteHandlers } from "@questpie/next"

export const { GET, POST, PATCH, DELETE } = questpieNextRouteHandlers(app)`,
  },
};

export function Frameworks() {
  return (
    <section className="py-24 border-t border-border/30">
      <div className="w-full max-w-7xl mx-auto px-4 text-center">
        <h2 className="font-mono text-sm tracking-[0.2em] uppercase text-primary mb-4">
          Adapters
        </h2>
        <h3 className="text-3xl font-bold mb-6">Deploy Anywhere</h3>
        <p className="text-muted-foreground max-w-2xl mx-auto mb-12">
          Write your CMS once. Mount it on any HTTP framework with a one-line adapter.
          Hono, Elysia, Next.js — pick your runtime, keep your code.
        </p>

        <div className="max-w-3xl mx-auto">
          <Tabs defaultValue="hono">
            <div className="flex justify-center mb-8">
              <TabsList>
                <TabsTrigger value="hono">Hono</TabsTrigger>
                <TabsTrigger value="elysia">Elysia</TabsTrigger>
                <TabsTrigger value="next">Next.js</TabsTrigger>
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
