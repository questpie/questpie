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
		code: `import { defineCollection } from '@questpie/cms/server'
import { varchar, timestamp, boolean } from 'drizzle-orm/pg-core'

export const barbers = defineCollection('barbers')
  .fields({
    name: varchar('name', { length: 255 }).notNull(),
    email: varchar('email', { length: 255 }).notNull().unique(),
    isActive: boolean('is_active').default(true).notNull()
  })

export const appointments = defineCollection('appointments')
  .fields({
    barberId: varchar('barber_id', { length: 255 }).notNull(),
    customerName: varchar('customer_name', { length: 255 }).notNull(),
    scheduledAt: timestamp('scheduled_at').notNull(),
    status: varchar('status', { length: 50 }).default('pending')
  })`,
	},

	// 2. Create CMS instance
	{
		id: 2,
		file: "cms.ts",
		action: "Create CMS instance",
		mode: "full",
		code: `import { defineQCMS } from '@questpie/cms/server'
import { barbers, appointments } from './collections'

export const cms = defineQCMS({ name: 'barbershop' })
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
		code: `import { defineJob } from '@questpie/cms/server'
import { z } from 'zod'

export const sendReminder = defineJob({
  name: 'send-reminder',
  schema: z.object({
    appointmentId: z.string(),
    email: z.string().email()
  }),
  handler: async ({ appointmentId, email }) => {
    // Send reminder email
    console.log(\`Reminder sent to \${email}\`)
  }
})`,
	},

	// 4. Register job in CMS
	{
		id: 4,
		file: "cms.ts",
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
    afterCreate: async ({ data, cms }) => {
      // Queue reminder 1 hour before appointment
      await cms.queue['send-reminder'].publish({
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
		file: "cms.ts",
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
import { cms } from './cms'

const app = new Hono()
  .route('/cms', questpieHono(cms))

export default {
  port: 3000,
  fetch: app.fetch
}`,
	},

	// 8. Type-safe client
	{
		id: 8,
		file: "client.ts",
		action: "Use type-safe client",
		mode: "full",
		code: `import { createQCMSClient } from '@questpie/cms/client'
import type { cms } from './cms'

const client = createQCMSClient<typeof cms>({
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
