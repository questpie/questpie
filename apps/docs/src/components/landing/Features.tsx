import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeWindow } from "./CodeWindow";

const features = [
	{
		id: "collections",
		label: "Collections",
		title: "Schema + API + Admin in One Chain",
		description:
			"Define your data model with the field factory. Chain .admin() for the panel, .list() for table views, .form() for editors, .access() for permissions. One file, complete feature.",
		file: "server/collections/posts.ts",
		code: `const posts = qb.collection('posts')
  .fields((f) => ({
    title: f.text({ required: true }),
    status: f.select({
      options: ['draft', 'published'],
      default: 'draft',
    }),
    author: f.relation({ to: 'users' }),
  }))
  .admin(({ c }) => ({
    label: 'Posts',
    icon: c.icon('ph:article'),
  }))
  .list(({ v, f }) => v.table({
    columns: [f.title, f.status, f.author],
    searchable: ['title'],
  }))
  .access({
    read: true,
    create: ({ user }) => !!user,
    update: ({ user, doc }) => user?.id === doc.authorId,
  })`,
	},
	{
		id: "dashboard",
		label: "Dashboard",
		title: "Real Data, Not Placeholder Charts",
		description:
			"Build dashboards with 9 widget types — stats, charts, tables, timelines, progress bars. Each widget runs fetchFn server-side with full database access.",
		file: "server/cms.ts",
		code: `.dashboard(({ d, c }) => d.dashboard({
  items: [
    d.stats({
      collection: 'posts',
      label: 'Total Posts',
      icon: c.icon('ph:article'),
    }),
    d.value({
      id: 'revenue',
      label: 'Revenue',
      icon: c.icon('ph:currency-circle-dollar'),
      fetchFn: async ({ db }) => {
        const result = await db.select(...)
        return { value: result.total, formatted: '$42K' }
      },
    }),
    d.chart({
      collection: 'orders',
      chartType: 'line',
      dateField: 'createdAt',
      label: 'Orders Over Time',
    }),
  ],
}))`,
	},
	{
		id: "jobs",
		label: "Jobs",
		title: "Postgres-Powered, Zero Extra Infra",
		description:
			"Define background jobs with Zod schemas. Publish with type safety. Retries, scheduling, priorities — all powered by pg-boss on Postgres. No Redis required.",
		file: "server/jobs/send-email.ts",
		code: `const sendEmail = q.job({
  name: 'send-email',
  schema: z.object({
    to: z.string().email(),
    template: z.string(),
  }),
  handler: async ({ payload, app }) => {
    const cms = getApp(app)
    await cms.email.send({
      to: payload.to,
      subject: 'Welcome!',
      text: \`Hello from \${cms.config.name}\`,
    })
  },
})

// Type-safe publish — autocomplete on payload shape
await cms.queue.sendEmail.publish({
  to: 'user@example.com',
  template: 'welcome',
})`,
	},
	{
		id: "client",
		label: "Client SDK",
		title: "Full Inference, Zero Codegen",
		description:
			"Pass your CMS type to createClient and get full autocomplete on collections, relations, and RPC functions. No code generation step, no build plugin.",
		file: "lib/cms-client.ts",
		code: `import { createClient } from 'questpie/client'
import type { AppCMS, AppRpc } from './server/cms'

const client = createClient<AppCMS, AppRpc>({
  baseURL: 'http://localhost:3000',
  basePath: '/api/cms',
})

// Fully typed — autocomplete on fields and relations
const { docs } = await client.collections.posts.find({
  where: { status: 'published' },
  with: { author: true },
})

// Type-safe RPC calls
const stats = await client.rpc.getRevenueStats({
  startDate: '2026-01-01',
  endDate: '2026-01-31',
})`,
	},
];

export function Features() {
	return (
		<section
			id="features"
			className="py-24 relative overflow-hidden border-t border-border/30"
		>
			{/* Background glow */}
			<div className="absolute top-1/2 left-1/4 w-[400px] h-[400px] bg-primary/3 rounded-full blur-[150px] -translate-y-1/2" />

			<div className="w-full max-w-7xl mx-auto px-4 relative z-10">
				<div className="text-center max-w-2xl mx-auto space-y-4 mb-12">
					<h2 className="font-mono text-sm tracking-[0.2em] uppercase text-primary">
						Capabilities
					</h2>
					<h3 className="text-3xl md:text-4xl font-bold">
						One Definition. Complete Backend.
					</h3>
					<p className="text-muted-foreground">
						Your collection definition is your API, your admin panel, and your access control layer. One source of truth, wired together with TypeScript.
					</p>
				</div>

				<Tabs defaultValue="collections" className="max-w-5xl mx-auto">
					<div className="flex justify-center mb-8">
						<TabsList>
							{features.map((feature) => (
								<TabsTrigger key={feature.id} value={feature.id}>
									{feature.label}
								</TabsTrigger>
							))}
						</TabsList>
					</div>

					{features.map((feature) => (
						<TabsContent key={feature.id} value={feature.id} className="mt-0">
							<div className="grid lg:grid-cols-[1fr_1.5fr] gap-8 items-start">
								{/* Description */}
								<div className="space-y-4 lg:pt-4">
									<h4 className="text-xl font-bold">{feature.title}</h4>
									<p className="font-mono text-xs text-primary uppercase tracking-wider">
										{feature.id}
									</p>
									<p className="text-muted-foreground leading-relaxed">
										{feature.description}
									</p>
								</div>

								{/* Code */}
								<CodeWindow
									title={feature.file}
									className="shadow-xl shadow-primary/5"
								>
									{feature.code}
								</CodeWindow>
							</div>
						</TabsContent>
					))}
				</Tabs>
			</div>
		</section>
	);
}
