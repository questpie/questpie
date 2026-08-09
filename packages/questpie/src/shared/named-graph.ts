type NamedGraphOptions<TNode extends object> = {
	kind: string;
	children(node: TNode): readonly TNode[];
	name(node: TNode): string | undefined;
};

type GraphOccurrence<TNode> = {
	node: TNode;
	path: string[];
};

type NamedOccurrenceOptions<TNode extends object, TOccurrence> = {
	kind: string;
	node(occurrence: TOccurrence): TNode;
	name(node: TNode): string | undefined;
	source(occurrence: TOccurrence): string;
};

type NamedIdentity<TNode extends object> = {
	node: TNode;
	source: string;
};

function registerNamedIdentity<TNode extends object>(
	node: TNode,
	name: string | undefined,
	source: string,
	kind: string,
	sourceLabel: "path" | "source",
	firstByName: Map<string, NamedIdentity<TNode>>,
): "first" | "repeated" {
	if (name === undefined) return "first";

	const first = firstByName.get(name);
	if (first?.node === node) return "repeated";
	if (first) {
		throw new Error(
			`[QUESTPIE] Two different ${kind}s are both named "${name}". ` +
				`First ${sourceLabel}: ${first.source}. ` +
				`Conflicting ${sourceLabel}: ${source}.`,
		);
	}

	firstByName.set(name, { node, source });
	return "first";
}

/** Deduplicate named occurrences by identity and reject ambiguous names. */
export function resolveNamedOccurrences<TNode extends object, TOccurrence>(
	occurrences: readonly TOccurrence[],
	options: NamedOccurrenceOptions<TNode, TOccurrence>,
): TNode[] {
	const resolved: TNode[] = [];
	const firstByName = new Map<string, NamedIdentity<TNode>>();

	for (const occurrence of occurrences) {
		const node = options.node(occurrence);
		if (
			registerNamedIdentity(
				node,
				options.name(node),
				options.source(occurrence),
				options.kind,
				"source",
				firstByName,
			) === "first"
		) {
			resolved.push(node);
		}
	}

	return resolved;
}

/** Resolve a named dependency graph children-first with one collision policy. */
export function resolveNamedGraph<TNode extends object>(
	roots: readonly TNode[],
	options: NamedGraphOptions<TNode>,
): TNode[] {
	const resolved: TNode[] = [];
	const states = new WeakMap<TNode, "visiting" | "visited">();
	const firstByName = new Map<string, NamedIdentity<TNode>>();
	const stack: GraphOccurrence<TNode>[] = [];

	const label = (node: TNode) =>
		options.name(node) ?? `<anonymous-${options.kind}>`;

	function visit(node: TNode, parentPath: readonly string[]): void {
		const nodeName = options.name(node);
		const path = [...parentPath, label(node)];
		registerNamedIdentity(
			node,
			nodeName,
			path.join(" -> "),
			options.kind,
			"path",
			firstByName,
		);

		const state = states.get(node);
		if (state === "visited") return;
		if (state === "visiting") {
			const cycleStart = stack.findIndex((entry) => entry.node === node);
			const cycle = [
				...stack.slice(cycleStart).map((entry) => label(entry.node)),
				label(node),
			];
			throw new Error(
				`[QUESTPIE] Circular ${options.kind} dependency: ${cycle.join(" -> ")}`,
			);
		}

		states.set(node, "visiting");
		stack.push({ node, path });
		for (const child of options.children(node)) visit(child, path);
		stack.pop();
		states.set(node, "visited");
		resolved.push(node);
	}

	for (const root of roots) visit(root, []);
	return resolved;
}
