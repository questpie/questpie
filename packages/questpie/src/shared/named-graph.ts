type NamedGraphOptions<TNode extends object> = {
	kind: string;
	children(node: TNode): readonly TNode[];
	name(node: TNode): string | undefined;
};

type GraphOccurrence<TNode> = {
	node: TNode;
	path: string[];
};

/** Resolve a named dependency graph children-first with one collision policy. */
export function resolveNamedGraph<TNode extends object>(
	roots: readonly TNode[],
	options: NamedGraphOptions<TNode>,
): TNode[] {
	const resolved: TNode[] = [];
	const states = new WeakMap<TNode, "visiting" | "visited">();
	const firstByName = new Map<string, GraphOccurrence<TNode>>();
	const stack: GraphOccurrence<TNode>[] = [];

	const label = (node: TNode) =>
		options.name(node) ?? `<anonymous-${options.kind}>`;

	function visit(node: TNode, parentPath: readonly string[]): void {
		const nodeName = options.name(node);
		const path = [...parentPath, label(node)];
		if (nodeName !== undefined) {
			const first = firstByName.get(nodeName);
			if (first && first.node !== node) {
				throw new Error(
					`[QUESTPIE] Two different ${options.kind}s are both named "${nodeName}". ` +
						`First path: ${first.path.join(" -> ")}. ` +
						`Conflicting path: ${path.join(" -> ")}.`,
				);
			}
			if (!first) firstByName.set(nodeName, { node, path });
		}

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
