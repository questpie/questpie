import { z } from "zod";

import { mcpTool } from "@questpie/mcp";

const inputSchema = z.object({
	barberId: z.string().describe("ID of the barber"),
	date: z.string().describe("Date in yyyy-MM-dd format"),
});

export default mcpTool("barbershop.check-availability", {
	description:
		"Check whether a barber is available on a given date. Returns working hours and booked time slots.",
	inputSchema,
	annotations: { readOnlyHint: true },
}).handler(async ({ input, ctx }) => {
	const { barberId, date } = input;

	const barber = await ctx.collections.barbers
		.findOne({ where: { id: barberId } })
		.catch(() => null);

	if (!barber || !barber.isActive) {
		return {
			structuredContent: {
				available: false,
				reason: "Barber not found or inactive",
			},
			content: [
				{ type: "text" as const, text: "Barber not found or inactive." },
			],
		};
	}

	const dayNames = [
		"sunday",
		"monday",
		"tuesday",
		"wednesday",
		"thursday",
		"friday",
		"saturday",
	] as const;

	const [year, month, day] = date.split("-").map(Number);
	const dateObj = new Date(year, month - 1, day);
	const dayKey = dayNames[dateObj.getDay()];
	const workingHours = barber.workingHours;
	const daySchedule = workingHours?.[dayKey];

	if (!daySchedule?.isOpen || !daySchedule.start || !daySchedule.end) {
		return {
			structuredContent: {
				available: false,
				reason: `Barber is closed on ${dayKey}`,
			},
			content: [
				{ type: "text" as const, text: `Barber is closed on ${dayKey}.` },
			],
		};
	}

	const startOfDay = new Date(dateObj);
	startOfDay.setHours(0, 0, 0, 0);
	const endOfDay = new Date(dateObj);
	endOfDay.setHours(23, 59, 59, 999);

	const appointments = await ctx.collections.appointments.find({
		where: {
			barber: barberId,
			scheduledAt: { gte: startOfDay, lte: endOfDay },
		},
	});

	const booked = appointments.docs
		.filter((apt) => apt.status !== "cancelled")
		.map((apt) => ({
			scheduledAt: apt.scheduledAt,
			status: apt.status,
		}));

	return {
		structuredContent: {
			available: true,
			barber: { id: barber.id, name: barber.name },
			date,
			workingHours: {
				start: daySchedule.start,
				end: daySchedule.end,
			},
			bookedSlots: booked,
		},
		content: [
			{
				type: "text" as const,
				text: `${barber.name} is open on ${date} from ${daySchedule.start} to ${daySchedule.end} with ${booked.length} existing appointment(s).`,
			},
		],
	};
});
