import { CodeWindow } from "./CodeWindow";

const steps = [
	{
		number: "01",
		title: "Define Your Schema",
		description:
			"Use the field factory to define your data model. Text, rich text, uploads, relations, arrays, objects — 22+ types with built-in validation.",
		code: `const posts = qb.collection('posts')
  .fields((f) => ({
    title: f.text({ required: true }),
    content: f.richText(),
    cover: f.upload({ to: 'assets' }),
    author: f.relation({ to: 'users' }),
    published: f.boolean({ default: false }),
  }))`,
		file: "server/collections/posts.ts",
	},
	{
		number: "02",
		title: "Chain Admin Config",
		description:
			"On the same collection, chain .admin(), .list(), .form() to configure how it appears in the admin panel. Everything stays in one file.",
		code: `  .admin(({ c }) => ({
    label: 'Posts',
    icon: c.icon('ph:article'),
  }))
  .list(({ v, f }) => v.table({
    columns: [f.title, f.published],
    searchable: ['title'],
  }))
  .form(({ v, f }) => v.form({
    fields: [f.title, f.content, f.cover, f.published],
  }))`,
		file: "server/collections/posts.ts",
	},
	{
		number: "03",
		title: "Build & Ship",
		description:
			"Wire collections into the CMS builder with auth, jobs, and storage. You get a REST API, type-safe client SDK, and a complete admin panel.",
		code: `const cms = q({ name: 'my-cms' })
  .use(adminModule)
  .collections({ posts, pages, authors })
  .auth({ emailAndPassword: { enabled: true } })
  .build({
    db: { url: process.env.DATABASE_URL },
    storage: { basePath: '/api/cms' },
  })

export type AppCMS = typeof cms`,
		file: "server/cms.ts",
	},
];

export function HowItWorks() {
	return (
		<section className="py-24 border-t border-border/30 relative overflow-hidden">
			<div className="absolute top-1/2 right-1/4 w-[400px] h-[400px] bg-primary/3 rounded-full blur-[150px] -translate-y-1/2" />

			<div className="w-full max-w-7xl mx-auto px-4 relative z-10">
				<div className="text-center max-w-2xl mx-auto space-y-4 mb-20">
					<h2 className="font-mono text-sm tracking-[0.2em] uppercase text-primary">
						How It Works
					</h2>
					<h3 className="text-3xl md:text-4xl font-bold">
						Three Steps. Complete CMS.
					</h3>
					<p className="text-muted-foreground">
						Define your data, configure the admin, build. No boilerplate, no separate frontend codebase, no code generation.
					</p>
				</div>

				<div className="space-y-16">
					{steps.map((step, i) => (
						<div key={step.number} className="grid lg:grid-cols-2 gap-8 items-start">
							{/* Description */}
							<div className={`space-y-4 ${i % 2 === 1 ? "lg:order-2" : ""}`}>
								<div className="flex items-center gap-4">
									<span className="text-5xl font-bold text-primary/20 leading-none font-mono">
										{step.number}
									</span>
									<div>
										<h4 className="text-xl font-bold">{step.title}</h4>
									</div>
								</div>
								<p className="text-muted-foreground leading-relaxed pl-[76px]">
									{step.description}
								</p>

								{/* Connector line to next step */}
								{i < steps.length - 1 && (
									<div className="hidden lg:block pl-[38px] pt-4">
										<div className="w-px h-8 bg-gradient-to-b from-primary/30 to-transparent" />
									</div>
								)}
							</div>

							{/* Code */}
							<div className={i % 2 === 1 ? "lg:order-1" : ""}>
								<CodeWindow title={step.file}>{step.code}</CodeWindow>
							</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
