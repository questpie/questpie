import type { Seed } from "questpie";
import { demoDataSeed } from "./demo-data.seed.js";
import { siteSettingsSeed } from "./site-settings.seed.js";
export const seeds: Seed[] = [siteSettingsSeed, demoDataSeed];
