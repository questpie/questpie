import { digest } from "../canonical";
import type { MigrationStepKindV1, MigrationStepV1 } from "./contracts";
import type { MigrationClassification } from "./migration-classification";

export function createMigrationStep(
	input: Readonly<{
		kind: MigrationStepKindV1;
		targetIdentity: string;
		containerIdentity: string;
		lock: MigrationStepV1["lock"];
		scansData: boolean;
		rewritesTable: boolean;
		reversibleWithoutData: boolean;
		classification: MigrationClassification;
	}>,
): MigrationStepV1 {
	return {
		stepId: digest("questpie-migration-step-v1", input),
		...input,
	};
}
