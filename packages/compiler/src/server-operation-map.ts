import { compareAscii } from "./canonical";
import { CompilerDiagnosticError } from "./diagnostic";
import type { NormalizedResource } from "./types";

type OperationOrigin = NormalizedResource["origin"];

export type ServerOperationMember = Readonly<{
	name: string;
	origin: OperationOrigin;
	value: string;
}>;

type Leaf = Readonly<{ member: ServerOperationMember }>;
type Branch = Map<string, Branch | Leaf>;

function originLabel(origin: OperationOrigin): string {
	return `${origin.packageId ?? "application"}:${origin.logicalPath}#${origin.exportName}`;
}

function invalidName(kind: string, member: ServerOperationMember): never {
	throw new CompilerDiagnosticError(
		"QP-COMPOSE-003",
		"invalidResourceName",
		`${kind} ${member.name} violates the Qualified Resource Name grammar at ${originLabel(member.origin)}`,
		{ kind, name: member.name, origins: [member.origin] },
	);
}

function unsafeName(kind: string, member: ServerOperationMember): never {
	throw new CompilerDiagnosticError(
		"QP-COMPOSE-024",
		"operationProjectionUnsafeName",
		`${kind} ${member.name} ends with then at ${originLabel(member.origin)}`,
		{ kind, name: member.name, origins: [member.origin] },
	);
}

function collision(
	kind: string,
	left: ServerOperationMember,
	right: ServerOperationMember,
): never {
	const missingAuthority = "explicit namespace or Augmentation Contract";
	throw new CompilerDiagnosticError(
		"QP-COMPOSE-023",
		"operationProjectionCollision",
		`${kind} ${left.name} at ${originLabel(left.origin)} conflicts with ${right.name} at ${originLabel(right.origin)}; missing ${missingAuthority}`,
		{
			kind,
			names: [left.name, right.name],
			origins: [left.origin, right.origin],
			missingAuthority,
		},
	);
}

function validateName(kind: string, member: ServerOperationMember): void {
	if (
		member.name.length > 255 ||
		member.name
			.split(".")
			.some(
				(segment) =>
					segment.length > 63 || !/^[a-z][A-Za-z0-9]*$/.test(segment),
			)
	)
		invalidName(kind, member);
	if (member.name.split(".").at(-1) === "then") unsafeName(kind, member);
}

function firstLeaf(branch: Branch): Leaf {
	for (const value of branch.values())
		if (value instanceof Map) return firstLeaf(value);
		else return value;
	throw new TypeError("server Operation namespace is empty");
}

function operationTree(
	kind: string,
	members: readonly ServerOperationMember[],
): Branch {
	const root: Branch = new Map();
	for (const member of members.toSorted((left, right) =>
		compareAscii(left.name, right.name),
	)) {
		validateName(kind, member);
		const segments = member.name.split(".");
		let branch = root;
		for (const [index, segment] of segments.entries()) {
			const existing = branch.get(segment);
			const leaf = index === segments.length - 1;
			if (leaf) {
				if (existing instanceof Map)
					collision(kind, firstLeaf(existing).member, member);
				if (existing !== undefined) collision(kind, existing.member, member);
				branch.set(segment, { member });
				continue;
			}
			if (existing !== undefined && !(existing instanceof Map))
				collision(kind, existing.member, member);
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
		value instanceof Map
			? `readonly ${JSON.stringify(name)}: ${renderTypeBranch(value)};`
			: `readonly ${JSON.stringify(name)}: ${value.member.value};`,
	);
	return `Readonly<{ ${members.join(" ")} }>`;
}

function renderValueBranch(branch: Branch): string {
	const members = [...branch].map(
		([name, value]) =>
			`${JSON.stringify(name)}: ${value instanceof Map ? renderValueBranch(value) : value.member.value}`,
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
