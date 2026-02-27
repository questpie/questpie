import { CodeWindow } from "./CodeWindow";

const steps = [
	{
		number: "01",
		title: "Type-safe collections with relations",
		description:
			"Define collections with typed fields, relations, and validation. One definition generates the database schema, REST API, and admin forms.",
		file: "collections/appointments.collection.ts",
		code: `const appointments = collection("appointments")
  .fields(({ f }) => ({
    customer: f.text({ required: true }),
    barber: f.relation({ to: "barbers" }),
    service: f.relation({ to: "services" }),
    date: f.date({ required: true }),
    status: f.select({
      options: ["pending", "confirmed", "completed"],
      default: "pending",
    }),
    price: f.number(),
  }))`,
	},
	{
		number: "02",
		title: "Custom functions with end-to-end types",
		description:
			"Define typed functions for business logic. Input validation, database access, and return types — all inferred.",
		file: "functions/get-available-slots.ts",
		code: `import { fn } from 'questpie'

export default fn({
  schema: z.object({
    barberId: z.string(),
    date: z.string(),
  }),
  handler: async ({ input, collections }) => {
    const booked = await collections.appointments.find({
      where: {
        barber: input.barberId,
        date: input.date,
        status: { in: ["pending", "confirmed"] },
      },
    });
    return calculateFreeSlots(input.date, booked.docs);
  },
});`,
	},
	{
		number: "03",
		title: "Typed client SDK — full autocomplete",
		description:
			"Query collections and call functions with complete type safety. No codegen step required.",
		file: "app/dashboard.tsx",
		code: `// Collections — fully typed filters, sort, relations
const { docs: upcoming } = await client.collections.appointments.find({
  where: {
    date: { gte: new Date() },
    status: { in: ["pending", "confirmed"] },
  },
  with: { barber: true, service: true },
  sort: { date: "asc" },
  limit: 10,
});

// Functions — fully typed input and output
const slots = await client.fn.getAvailableSlots({
  barberId: selectedBarber.id,
  date: "2025-03-15",
});`,
	},
];

export function HowItWorks() {
	return (
		<section id="workflow" className="border-t border-border/40 py-20">
			<div className="mx-auto w-full max-w-7xl px-4">
				<div className="mx-auto mb-14 max-w-2xl space-y-3 text-center">
					<h2 className="font-mono text-sm uppercase tracking-[0.2em] text-primary">
						Real-world patterns
					</h2>
					<h3 className="text-3xl font-bold tracking-tight md:text-4xl">
						See it in action.
					</h3>
				</div>

				<div className="mx-auto max-w-4xl space-y-12">
					{steps.map((step) => (
						<div key={step.number} className="space-y-4">
							<div className="flex items-center gap-4">
								<span className="font-mono text-4xl leading-none text-primary/25">
									{step.number}
								</span>
								<div>
									<h4 className="text-xl font-semibold">{step.title}</h4>
									<p className="text-sm text-muted-foreground">
										{step.description}
									</p>
								</div>
							</div>
							<CodeWindow title={step.file}>{step.code}</CodeWindow>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
