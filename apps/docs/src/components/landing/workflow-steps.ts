interface LinePatch {
	line: number; // -1 means append to end, 0 means prepend, positive = insert after that line
	code: string;
}

interface WorkflowStep {
	id: number;
	file: string;
	action: string;
	mode: "full" | "patch"; // full = show complete code, patch = line-based insertions
	code?: string; // for "full" mode
	patches?: LinePatch[]; // for "patch" mode
}

export const workflowSteps: WorkflowStep[] = [
	// 1. Define collections with Drizzle
	{
		id: 1,
		file: "collections.ts",
		action: "Define collections",
		mode: "full",
		code: `import { q } from 'questpie'
import { varchar, timestamp, boolean } from 'drizzle-orm/pg-core'

export const barbers = q.collection('barbers')
  .fields({
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    isActive: boolean('is_active').default(true).notNull()
  })

export const appointments = q.collection('appointments')
  .fields({
    barberId: varchar('barber_id', { length: 255 }).notNull(),
    customerName: varchar('customer_name', { length: 255 }).notNull(),
    scheduledAt: timestamp('scheduled_at').notNull(),
    status: varchar('status', { length: 50 }).default('pending')
  })`,
	},

	// 2. Create app instance
	{
		id: 2,
		file: "app.ts",
		action: "Create app instance",
		mode: "full",
		code: `import { q } from 'questpie'
import { barbers, appointments } from './collections'

export const app = q({ name: 'barbershop' })
  .collections({
    barbers,
    appointments
  })`,
	},

	// 3. Add a background job
	{
		id: 3,
		file: "jobs.ts",
		action: "Add background job",
		mode: "full",
		code: `import { q } from 'questpie'
import { z } from 'zod'

export const sendReminder = q.job({
  name: 'send-reminder',
  schema: z.object({
    appointmentId: z.string(),
    email: z.string().email()
  }),
  handler: async (payload) => {
    // Send reminder email
    console.log(\`Reminder sent to \${payload.email}\`)
  }
})`,
	},

	// 4. Register job in app
	{
		id: 4,
		file: "app.ts",
		action: "Register job",
		mode: "patch",
		patches: [
			{ line: 2, code: "import { sendReminder } from './jobs'" },
			{ line: -1, code: "  .jobs({ 'send-reminder': sendReminder })" },
		],
	},

	// 5. Add hooks to collection
	{
		id: 5,
		file: "collections.ts",
		action: "Add lifecycle hooks",
		mode: "patch",
		patches: [
			{
				line: -1,
				code: `  .hooks({
    afterChange: async ({ data, operation }) => {
      if (operation !== 'create') return
      const app = getAppFromContext()
      // Queue reminder 1 hour before appointment
      await app.queue.sendReminder.publish({
        appointmentId: data.id,
        email: data.customerEmail
      })
    }
  })`,
			},
		],
	},

	// 6. Build with config
	{
		id: 6,
		file: "app.ts",
		action: "Build with config",
		mode: "patch",
		patches: [
			{
				line: -1,
				code: `  .build({
    db: { url: process.env.DATABASE_URL },
    queue: { adapter: pgBossAdapter() }
  })`,
			},
		],
	},

	// 7. Mount to Hono
	{
		id: 7,
		file: "server.ts",
		action: "Mount to Hono",
		mode: "full",
		code: `import { Hono } from 'hono'
import { questpieHono } from '@questpie/hono'
import { app as questpieApp } from './app'

const server = new Hono()
  .route('/api', questpieHono(questpieApp))

export default {
  port: 3000,
  fetch: server.fetch
}`,
	},

	// 8. Type-safe client
	{
		id: 8,
		file: "client.ts",
		action: "Use type-safe client",
		mode: "full",
		code: `import { createClient } from 'questpie/client'
import type { app } from './app'

const client = createClient<typeof app>({
  baseURL: 'http://localhost:3000'
})

// Fully typed
const { docs } = await client.collections.barbers.find({
  where: { isActive: true }
})

// Create appointment
await client.collections.appointments.create({
  barberId: docs[0].id,
  customerName: 'John Doe',
  scheduledAt: new Date()
})`,
	},
];
