import type { LinkedCollectionLifecycleProgramV1 } from "./lifecycle";

type RecordValue = Readonly<Record<string, unknown>>;
type Phase = "normalize" | "validate" | "check" | "afterWrite";

function hasCapability(value: unknown): boolean {
	if (Array.isArray(value)) return value.some(hasCapability);
	if (!value || typeof value !== "object") return false;
	const entry = value as RecordValue;
	return entry.op === "capability" || Object.values(entry).some(hasCapability);
}

function hasStatement(value: unknown, operation: string): boolean {
	if (Array.isArray(value))
		return value.some((member) => hasStatement(member, operation));
	if (!value || typeof value !== "object") return false;
	const entry = value as RecordValue;
	return (
		entry.op === operation ||
		Object.values(entry).some((member) => hasStatement(member, operation))
	);
}

function structuralArgumentKeys(
	value: unknown,
	prefix = "",
): readonly string[] {
	const expression = value as RecordValue;
	if (expression.op !== "object") return [];
	return (expression.entries as readonly RecordValue[]).flatMap((entry) => {
		if (entry.kind !== "argument") return [];
		const path = `${prefix}${String(entry.key)}`;
		const nested = structuralArgumentKeys(entry.value, `${path}.`);
		return nested.length === 0 ? [path] : nested;
	});
}

export function validateLifecycleCapabilities(
	phases: Readonly<Record<Phase, readonly RecordValue[]>>,
	bindings: LinkedCollectionLifecycleProgramV1["bindings"],
	label: string,
	fail: (message: string) => never,
): void {
	if (hasCapability(phases.normalize) || hasCapability(phases.validate))
		fail(`${label} capability is not admitted in this phase`);
	if (hasStatement(phases.normalize, "throwIssue"))
		fail(`${label} normalize cannot throw Collection Issues`);
	if (hasStatement(phases.afterWrite, "throwIssue"))
		fail(`${label} afterWrite cannot throw Collection Issues`);
	const invoked = new Set<string>();
	const visit = (
		statements: readonly RecordValue[],
		phase: "check" | "afterWrite",
		boundedSlots = new Set<number>(),
		definedSlots = new Set<number>(),
	) => {
		for (const statement of statements) {
			if (statement.op === "if") {
				visit(
					statement.consequent as readonly RecordValue[],
					phase,
					new Set(boundedSlots),
					new Set(definedSlots),
				);
				visit(
					statement.otherwise as readonly RecordValue[],
					phase,
					new Set(boundedSlots),
					new Set(definedSlots),
				);
				continue;
			}
			if (statement.op === "const") {
				const value = statement.value as RecordValue;
				if (value.op !== "capability") continue;
				if (value.capability !== "read")
					fail(`${label} ${phase} capability is invalid`);
				const binding = Object.values(bindings.capabilities).find(
					(candidate) => candidate.identity === value.identity,
				);
				if (
					!binding ||
					binding.kind !== "read" ||
					!bindings.operations.includes(binding.identity)
				)
					fail(`${label} ${phase} capability is unbound`);
				const args = value.arguments as readonly unknown[];
				const keys = args.length === 1 ? structuralArgumentKeys(args[0]) : [];
				if (
					keys.length !== binding.argumentKeys.length ||
					keys.some((key, index) => key !== binding.argumentKeys[index])
				)
					fail(`${label} ${phase} capability arguments are invalid`);
				invoked.add(binding.identity);
				const slot = Number(statement.slot);
				if (definedSlots.has(slot)) fail(`${label} local slot is duplicated`);
				definedSlots.add(slot);
				if (binding.cardinality === "many") boundedSlots.add(slot);
				continue;
			}
			if (statement.op === "forOf") {
				if (
					phase !== "afterWrite" ||
					!boundedSlots.has(Number(statement.sourceSlot)) ||
					definedSlots.has(Number(statement.slot))
				)
					fail(`${label} afterWrite forOf source is invalid`);
				const nestedDefined = new Set(definedSlots);
				nestedDefined.add(Number(statement.slot));
				visit(
					statement.body as readonly RecordValue[],
					phase,
					new Set(boundedSlots),
					nestedDefined,
				);
				continue;
			}
			if (phase === "afterWrite" && statement.op === "effect") {
				const value = statement.value as RecordValue;
				if (value.capability !== "write" && value.capability !== "acceptJob")
					fail(`${label} afterWrite capability is invalid`);
				const binding = Object.values(bindings.capabilities).find(
					(candidate) => candidate.identity === value.identity,
				);
				if (
					!binding ||
					binding.kind !== value.capability ||
					!(
						binding.kind === "acceptJob" ? bindings.jobs : bindings.operations
					).includes(binding.identity)
				)
					fail(`${label} afterWrite capability is unbound`);
				const args = value.arguments as readonly unknown[];
				const keys = args.length === 1 ? structuralArgumentKeys(args[0]) : [];
				if (
					keys.length !== binding.argumentKeys.length ||
					keys.some((key, index) => key !== binding.argumentKeys[index])
				)
					fail(`${label} afterWrite capability arguments are invalid`);
				invoked.add(binding.identity);
				continue;
			}
			if (hasCapability(statement)) fail(`${label} capability is misplaced`);
		}
	};
	visit(phases.check, "check");
	visit(phases.afterWrite, "afterWrite");
	for (const binding of Object.values(bindings.capabilities))
		if (!invoked.has(binding.identity))
			fail(`${label} capability binding is unused`);
}
