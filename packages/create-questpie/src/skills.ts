export const SKILLS_CLI_PACKAGE = "skills@1.5.17";
export const QUESTPIE_SKILLS_SOURCE = "questpie/questpie";
export const QUESTPIE_SKILL_NAMES = ["questpie", "questpie-admin"] as const;

export function getSkillsInstallArgs(
	source = QUESTPIE_SKILLS_SOURCE,
): string[] {
	return [
		SKILLS_CLI_PACKAGE,
		"add",
		source,
		"--skill",
		...QUESTPIE_SKILL_NAMES,
		"--yes",
		"--copy",
	];
}
