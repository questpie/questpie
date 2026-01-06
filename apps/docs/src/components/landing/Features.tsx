import { CodeWindow } from "./CodeWindow";
import { cn } from "@/lib/utils";

const features = [
	{
		title: "Collections",
		subtitle: "Drizzle schema + hooks + access control",
		description:
			"Define your schema with native Drizzle columns. Add hooks for business logic, access rules for permissions. That's it.",
		file: "src/collections/posts.ts",
		code: `const posts = defineCollection('posts')
  .fields({
    title: varchar('title', { length: 255 }).notNull(),
    status: varchar('status', { length: 20 }).default('draft'),
    authorId: varchar('author_id', { length: 255 }).notNull(),
  })
  .access({
    read: true,
    create: ({ user }) => !!user,
    update: ({ user, doc }) => user?.id === doc.authorId
  })
  .hooks({
    beforeCreate: async ({ data }) => {
      if (!data.slug) data.slug = slugify(data.title)
    }
  })`,
	},
	{
		title: "Relations",
		subtitle: "Drizzle relations, type-safe queries",
		description:
			"One-to-many, many-to-many—define them once, query with full type inference. Nested relations just work.",
		file: "src/collections/comments.ts",
		code: `const comments = defineCollection('comments')
  .fields({ postId: varchar('post_id').notNull() })
  .relations(({ one, table }) => ({
    post: one('posts', { 
      fields: [table.postId], 
      references: ['id'] 
    })
  }))

// Query with relations
const { docs } = await cms.api.collections.posts.find({
  with: { comments: { with: { author: true } } }
})`,
	},
	{
		title: "Background Jobs",
		subtitle: "pg-boss queues, no Redis needed",
		description:
			"Define jobs with Zod schemas. Publish with type checking. Retries, scheduling, priorities—all built on Postgres.",
		file: "src/jobs/send-email.ts",
		code: `const sendEmail = defineJob({
  name: 'send-email',
  schema: z.object({ 
    to: z.string().email(),
    template: z.string() 
  }),
  handler: async (payload) => {
    await mailer.send(payload)
  }
})

// Type-safe publish
await cms.queue['send-email'].publish({
  to: 'user@example.com',
  template: 'welcome'
})`,
	},
	{
		title: "Email Templates",
		subtitle: "React Email + type-safe context",
		description:
			"Write emails in React. Context is validated with Zod. Swap between SMTP, Resend, Sendgrid via adapters.",
		file: "src/emails/welcome.tsx",
		code: `const welcomeEmail = defineEmailTemplate({
  name: 'welcome',
  schema: z.object({ 
    name: z.string(),
    loginUrl: z.string().url() 
  }),
  subject: ({ name }) => \`Welcome, \${name}!\`,
  render: ({ name, loginUrl }) => (
    <Email>
      <h1>Hey {name}</h1>
      <Button href={loginUrl}>Get Started</Button>
    </Email>
  )
})`,
	},
	{
		title: "Custom Functions",
		subtitle: "Type-safe RPC, call from anywhere",
		description:
			"Define server functions with input/output validation. Call them from the client with full type inference.",
		file: "src/functions/checkout.ts",
		code: `// Server
const createCheckout = defineFunction({
  schema: z.object({ 
    items: z.array(z.object({ id: z.string(), qty: z.number() }))
  }),
  handler: async ({ items }, ctx) => {
    const total = await calculateTotal(items)
    return { checkoutUrl: \`/pay?amount=\${total}\` }
  }
})

// Client — fully typed
const { checkoutUrl } = await client.functions.createCheckout({
  items: [{ id: 'sku_123', qty: 2 }]
})`,
	},
	{
		title: "Type-Safe Client",
		subtitle: "No codegen, types flow from schema",
		description:
			"Create a client, pass your CMS type. Collections, functions, globals—all typed. Works in React, Vue, Svelte, anywhere.",
		file: "src/lib/api-client.ts",
		code: `import { createQCMSClient } from '@questpie/cms/client'
import type { cms } from './server'

const client = createQCMSClient<typeof cms>({
  baseURL: 'http://localhost:3000'
})

// Fully typed
const { docs } = await client.collections.posts.find({
  where: { status: 'published' },
  with: { author: true }
})

console.log(docs[0].title)       // string
console.log(docs[0].author.name) // string`,
	},
];

export function Features() {
	return (
		<section id="features" className="py-24 relative">
			<div className="w-full max-w-7xl mx-auto px-4 space-y-24">
				<div className="text-center max-w-2xl mx-auto space-y-4">
					<h2 className="font-mono text-sm tracking-[0.2em] uppercase text-primary">
						How It Works
					</h2>
					<h3 className="text-3xl md:text-4xl font-bold">
						Everything You Need, Nothing You Don't
					</h3>
					<p className="text-muted-foreground">
						Collections, jobs, email, auth—all wired together with TypeScript.
						Each piece uses a library you can learn independently.
					</p>
				</div>

				{features.map((feature, i) => (
					<div
						key={i}
						className={cn(
							"grid md:grid-cols-2 gap-12 items-center",
							i % 2 === 1 && "md:grid-flow-col-dense",
						)}
					>
						<div
							className={cn(
								"space-y-6 min-w-0",
								i % 2 === 1 && "md:col-start-2",
							)}
						>
							<div className="inline-block p-2 bg-primary/10 border border-primary/20 rounded-none">
								<div className="w-8 h-8 bg-primary/20 flex items-center justify-center font-mono font-bold text-primary">
									0{i + 1}
								</div>
							</div>
							<div>
								<h4 className="text-xl font-bold mb-2">{feature.title}</h4>
								<p className="font-mono text-xs text-primary uppercase tracking-wider mb-4">
									{feature.subtitle}
								</p>
								<p className="text-muted-foreground leading-relaxed">
									{feature.description}
								</p>
							</div>
						</div>

						<div className={cn(i % 2 === 1 && "md:col-start-1", "min-w-0")}>
							<CodeWindow
								title={feature.file}
								className="shadow-2xl shadow-primary/5"
							>
								{feature.code}
							</CodeWindow>
						</div>
					</div>
				))}
			</div>
		</section>
	);
}
