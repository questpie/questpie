import { CodeWindow } from "./CodeWindow";

const serverCode = `// collections/posts.ts
import { collection } from '#questpie'

export default collection('posts')
  .fields(({ f }) => ({
    title: f.text({ label: 'Title', required: true }),
    content: f.richText({ label: 'Content' }),
    published: f.boolean({ label: 'Published', default: false }),
  }))
  .admin(({ c }) => ({
    label: 'Posts',
    icon: c.icon('ph:article'),
  }))
  .list(({ v, f }) => v.collectionTable({
    columns: [f.title, f.published],
  }))
  .form(({ v, f }) => v.collectionForm({
    fields: [f.title, f.content, f.published],
  }))`;

const clientCode = `// admin/admin.ts
// Re-export the auto-generated admin config
export { default as admin } from "./.generated/client"

// That's it. Codegen wires everything.
// Fields, views, components — all from your server config.`;

export function Philosophy() {
	return (
		<section className="py-24 border-t border-border/30 relative overflow-hidden">
			{/* Background glows */}
			<div className="absolute top-0 left-1/3 w-[400px] h-[400px] bg-primary/3 rounded-full blur-[150px]" />
			<div className="absolute bottom-0 right-1/3 w-[300px] h-[300px] bg-primary/3 rounded-full blur-[120px]" />

			<div className="w-full max-w-7xl mx-auto px-4 relative z-10">
				{/* Header */}
				<div className="text-center max-w-2xl mx-auto space-y-4 mb-16">
					<h2 className="font-mono text-sm tracking-[0.2em] uppercase text-primary">
						Architecture
					</h2>
					<h3 className="text-3xl md:text-4xl font-bold">
						Server Owns the Truth. Client Just Renders.
					</h3>
					<p className="text-muted-foreground">
						Schema, validation, admin config, access rules — everything lives on
						the server. The client is a thin layer that reads config and applies
						your registries. Change once, everything updates.
					</p>
				</div>

				{/* Split code comparison */}
				<div className="grid lg:grid-cols-2 gap-6 mb-12">
					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<span className="font-mono text-xs text-primary font-medium">
								Server — collection() builder
							</span>
							<span className="text-sm text-muted-foreground">
								— Schema + Admin + Access
							</span>
						</div>
						<CodeWindow title="collections/posts.ts">{serverCode}</CodeWindow>
					</div>

					<div className="space-y-3">
						<div className="flex items-center gap-2">
							<span className="font-mono text-xs text-primary font-medium">
								Client — auto-generated
							</span>
							<span className="text-sm text-muted-foreground">
								— Codegen output
							</span>
						</div>
						<CodeWindow title="admin/admin.ts">{clientCode}</CodeWindow>
					</div>
				</div>

				{/* Benefits */}
				<div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 text-sm">
					{[
						{
							title: "Single source of truth",
							desc: "Schema, validation, and admin layout live in one place. No drift between backend and frontend.",
						},
						{
							title: "Composable modules",
							desc: "Auth, storage, jobs — each is a module. Add what you need, skip what you don't.",
						},
						{
							title: "Headless by default",
							desc: "The API works without admin. Ship an API-first backend, add the admin panel when you're ready.",
						},
						{
							title: "End-to-end types",
							desc: "Types flow from Drizzle schema to REST API to client SDK. A typo is a compile error, not a runtime bug.",
						},
					].map((item) => (
						<div key={item.title} className="space-y-2">
							<h4 className="font-medium">{item.title}</h4>
							<p className="text-muted-foreground">{item.desc}</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
