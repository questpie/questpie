import { route } from "questpie/services";
import z from "zod";

import { CollectionWhere } from "#questpie";

export default route()
	.post()
	.schema(
		z.object({
			startDate: z.string().datetime(),
			endDate: z.string().datetime(),
			completedOnly: z.boolean().optional().default(true),
		}),
	)
	.meta({
		title: "Get revenue stats",
		description:
			"Calculate revenue statistics for a date range based on completed appointments.",
		mcp: {
			expose: true,
			name: "reports.revenue",
			annotations: { readOnlyHint: true },
		},
	})
	.handler(async ({ input, collections }) => {
		const { startDate, endDate, completedOnly } = input;

		const where: CollectionWhere<"appointments"> = {
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
