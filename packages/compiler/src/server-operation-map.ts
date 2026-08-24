import { compareAscii } from "./canonical";
import { CompilerDiagnosticError } from "./diagnostic";

export type ServerOperationMember = Readonly<{
	name: string;
	value: string;
}>;

type Branch = Map<string, Branch | string>;

function invalid(message: string): never {
	throw new CompilerDiagnosticError(
		"QP-COMPOSE-013",
		"structuralTypeError",
		message,
	);
}

function operationTree(
	kind: string,
	members: readonly ServerOperationMember[],
): Branch {
	const root: Branch = new Map();
	for (const member of members.toSorted((left, right) =>
		compareAscii(left.name, right.name),
	)) {
		const segments = member.name.split(".");
		if (segments.at(-1) === "then")
			invalid(`${kind} ${member.name} cannot end with then`);
		let branch = root;
		for (const [index, segment] of segments.entries()) {
			const existing = branch.get(segment);
			const leaf = index === segments.length - 1;
			if (leaf) {
				if (existing instanceof Map)
					invalid(`${kind} ${member.name} collides with an existing namespace`);
				if (existing !== undefined)
					invalid(`${kind} ${member.name} is duplicated`);
				branch.set(segment, member.value);
				continue;
			}
			if (typeof existing === "string")
				invalid(`${kind} ${member.name} extends an existing operation leaf`);
			if (existing instanceof Map) {
				branch = existing;
				continue;
			}
			const child: Branch = new Map();
			branch.set(segment, child);
			branch = child;
		}
	}
	return root;
}

function renderTypeBranch(branch: Branch): string {
	const members = [...branch].map(([name, value]) =>
		typeof value === "string"
			? `readonly ${JSON.stringify(name)}: ${value};`
			: `readonly ${JSON.stringify(name)}: ${renderTypeBranch(value)};`,
	);
	return `Readonly<{ ${members.join(" ")} }>`;
}

function renderValueBranch(branch: Branch): string {
	const members = [...branch].map(
		([name, value]) =>
			`${JSON.stringify(name)}: ${typeof value === "string" ? value : renderValueBranch(value)}`,
	);
	return `Object.freeze(Object.assign(Object.create(null), {${members.join(",")}}))`;
}

export function renderServerOperationType(
	kind: string,
	members: readonly ServerOperationMember[],
): string {
	return renderTypeBranch(operationTree(kind, members));
}

export function renderServerOperationValue(
	kind: string,
	members: readonly ServerOperationMember[],
): string {
	return renderValueBranch(operationTree(kind, members));
}
