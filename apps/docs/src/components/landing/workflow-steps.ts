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
	// 1. Define collections
	{
		id: 1,
		file: "collections.ts",
		action: "Define collections",
		mode: "full",
		code: `import { collection } from '#questpie'

export const barbers = collection('barbers')
  .fields(({ f }) => ({
    name: f.text({ label: 'Name', required: true }),
    email: f.email({ label: 'Email', required: true }),
    isActive: f.boolean({ label: 'Active', default: true }),
  }))

export const appointments = collection('appointments')
  .fields(({ f }) => ({
    barberId: f.relation({ to: 'barbers', required: true }),
    customerName: f.text({ label: 'Customer', required: true }),
    scheduledAt: f.dateTime({ label: 'Scheduled At', required: true }),
    status: f.select({ label: 'Status', options: ['pending', 'confirmed', 'completed'], default: 'pending' }),
  }))`,
	},

	// 2. Create config
	{
		id: 2,
		file: "questpie.config.ts",
		action: "Create config",
		mode: "full",
		code: `import { runtimeConfig } from 'questpie'

export default runtimeConfig({
  db: { url: process.env.DATABASE_URL! },
  app: { url: process.env.APP_URL! },
})`,
	},

	// 3. Add a function
	{
		id: 3,
		file: "functions/send-reminder.ts",
		action: "Add a function",
		mode: "full",
		code: `import { fn } from 'questpie'
import { z } from 'zod'

export default fn({
  schema: z.object({
    appointmentId: z.string(),
    email: z.string().email(),
  }),
  handler: async ({ input, email }) => {
    // Send reminder email
    await email.send({
      to: input.email,
      subject: 'Appointment Reminder',
      text: \`Don't forget your appointment!\`,
    })
  },
})`,
	},

	// 4. Add lifecycle hooks
	{
		id: 4,
		file: "collections.ts",
		action: "Add lifecycle hooks",
		mode: "patch",
		patches: [
			{
				line: -1,
				code: `  .hooks({
    afterChange: async ({ data, operation, queue }) => {
      if (operation !== 'create') return
      // Call the send-reminder function
      await queue.sendReminder.publish({
        appointmentId: data.id,
        email: data.customerEmail,
      })
    }
  })`,
			},
		],
	},

	// 5. Create fetch handler
	{
		id: 5,
		file: "routes/api.ts",
		action: "Create fetch handler",
		mode: "full",
		code: `import { app } from '#questpie'
import { createFetchHandler } from 'questpie'

const handler = createFetchHandler(app, {
  basePath: '/api',
})

export default handler`,
	},

	// 6. Type-safe client
	{
		id: 6,
		file: "client.ts",
		action: "Use type-safe client",
		mode: "full",
		code: `import { createClient } from 'questpie/client'
import type { AppConfig } from '#questpie'

const client = createClient<AppConfig>({
  baseURL: 'http://localhost:3000',
})

// Fully typed
const { docs } = await client.collections.barbers.find({
  where: { isActive: true },
})

// Create appointment
await client.collections.appointments.create({
  barberId: docs[0].id,
  customerName: 'John Doe',
  scheduledAt: new Date(),
})`,
	},
];
