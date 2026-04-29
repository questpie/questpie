import { route } from "questpie";
import z from "zod";

export default route()
	.post()
	.schema(
		z.object({
			startDate: z.string().datetime(),
			endDate: z.string().datetime(),
			completedOnly: z.boolean().optional().default(true),
		}),
	)
	.handler(async ({ input, collections }) => {
		const { startDate, endDate, completedOnly } = input;

		const where: Record<string, unknown> = {
			scheduledAt: { gte: new Date(startDate), lte: new Date(endDate) },
		};
		if (completedOnly) {
			where.status = "completed";
		}

		const result = await collections.appointments.find({
			where,
			with: { service: true },
			limit: 10_000,
		});

		const docs = (result.docs ?? []) as Array<{ service?: { price?: number } }>;
		const totalRevenue = docs.reduce(
			(sum, apt) => sum + (apt.service?.price ?? 0),
			0,
		);
		const appointmentCount = docs.length;
		const avgRevenue =
			appointmentCount > 0 ? totalRevenue / appointmentCount : 0;

		return { totalRevenue, appointmentCount, avgRevenue };
	});
