import { service } from "questpie/services";
const SHIFT_START_HOUR = 8;

function nextShiftStart(from = new Date()): Date {
	const start = new Date(from);
	start.setHours(SHIFT_START_HOUR, 0, 0, 0);
	if (from.getHours() >= SHIFT_START_HOUR + 8) {
		start.setDate(start.getDate() + 1);
	}
	return start;
}

export default service({
	lifecycle: "singleton",
	create: () => ({
		estimateOrderWindow({
			quantity,
			minutesPerUnit,
			from,
		}: {
			quantity: number;
			minutesPerUnit: number;
			from?: Date;
		}) {
			const plannedStart = nextShiftStart(from);
			const plannedFinish = new Date(
				plannedStart.getTime() + quantity * minutesPerUnit * 60_000,
			);
			return { plannedStart, plannedFinish };
		},
	}),
});
