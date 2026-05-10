import { seed } from "questpie/services";
export default seed({
	id: "toyFactoryDemo",
	description: "Demo materials, toys, machines, and one production order",
	category: "dev",
	async run({ collections, createContext, log }) {
		const ctx = await createContext({ accessMode: "system", locale: "en" });
		const existing = await collections.toys.find(
			{ where: { sku: "DUCK-001" }, limit: 1 },
			ctx,
		);
		if (existing.totalDocs > 0) {
			log("Toy factory demo data already exists, skipping");
			return;
		}

		const wood = await collections.materials.create(
			{
				name: "Beech wood block",
				sku: "MAT-WOOD-BLOCK",
				unit: "pcs",
				onHand: 240,
				reorderPoint: 80,
				leadTimeDays: 4,
				isActive: true,
			},
			ctx,
		);
		const paint = await collections.materials.create(
			{
				name: "Yellow water-based paint",
				sku: "MAT-PAINT-YELLOW",
				unit: "l",
				onHand: 18,
				reorderPoint: 12,
				leadTimeDays: 2,
				isActive: true,
			},
			ctx,
		);
		const duck = await collections.toys.create(
			{
				name: "Wooden Duck",
				sku: "DUCK-001",
				status: "active",
				minutesPerUnit: 9,
				safetyStock: 40,
				notes: "Cut, sand, paint, and pack in batches of 50.",
			},
			ctx,
		);

		await collections.toyMaterials.create(
			{ toy: duck.id, material: wood.id, quantityPerUnit: 1, wastePercent: 5 },
			ctx,
		);
		await collections.toyMaterials.create(
			{
				toy: duck.id,
				material: paint.id,
				quantityPerUnit: 0.05,
				wastePercent: 10,
			},
			ctx,
		);

		await collections.machines.create(
			{
				name: "CNC Cutter 1",
				code: "CNC-1",
				station: "cutting",
				hourlyCapacity: 55,
				status: "available",
			},
			ctx,
		);
		await collections.machines.create(
			{
				name: "Paint Booth A",
				code: "PAINT-A",
				station: "painting",
				hourlyCapacity: 40,
				status: "available",
			},
			ctx,
		);

		await collections.productionOrders.create(
			{
				orderNo: "PO-1001",
				toy: duck.id,
				customerEmail: "ops@example.com",
				quantity: 180,
				priority: "normal",
				status: "draft",
				materialStatus: "unknown",
				dueDate: new Date(Date.now() + 1000 * 60 * 60 * 24 * 10),
				notes: "Demo order for the workflow/admin example.",
			},
			ctx,
		);

		log("Toy factory demo data created");
	},
});
