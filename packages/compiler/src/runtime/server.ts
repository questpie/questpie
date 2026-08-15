import { compareAscii } from "../canonical";
import type { PackageInventory } from "../types";

type ExecutableSlot = Readonly<{
	bundleExport: string;
	identity: string;
	slot: string;
	origin: Readonly<{
		path: string;
		exportName: string;
		packageId: string | null;
	}>;
}>;

export function renderServerExecutables(
	input: Readonly<{
		slots: readonly ExecutableSlot[];
		sourceRoot: string;
		inventories: readonly PackageInventory[];
	}>,
): string {
	const packageNames = new Map(
		input.inventories.map((inventory) => [
			inventory.package.id,
			inventory.package.name,
		]),
	);
	const sourceModule = (slot: ExecutableSlot): string => {
		if (slot.origin.packageId) {
			const packageName = packageNames.get(slot.origin.packageId);
			if (!packageName)
				throw new TypeError(
					`missing executable Package ${slot.origin.packageId}`,
				);
			return `${packageName}/questpie`;
		}
		const prefix =
			input.sourceRoot === "." ? "" : `${input.sourceRoot.replace(/\/$/, "")}/`;
		const path = slot.origin.path.startsWith(prefix)
			? slot.origin.path.slice(prefix.length)
			: slot.origin.path;
		return `#questpie/source/${path}`;
	};
	return `${[...input.slots]
		.sort((left, right) => compareAscii(left.bundleExport, right.bundleExport))
		.map(
			(slot, index) =>
				`import { ${slot.origin.exportName} as definition${index} } from ${JSON.stringify(sourceModule(slot))};\nexport const ${slot.bundleExport} = definition${index}.${slot.slot};`,
		)
		.join("\n")}
`;
}
