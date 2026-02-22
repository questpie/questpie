import type { Migration } from "questpie";

import { gentleAzureEagle20260206T174642 } from "./20260206T174642_gentle_azure_eagle.js";
import { fancyGreenTiger20260206T180920 } from "./20260206T180920_fancy_green_tiger.js";
import { calmBluePhoenix20260211T100836 } from "./20260211T100836_calm_blue_phoenix.js";
import { calmBlueDragon20260218T195452 } from "./20260218T195452_calm_blue_dragon.js";
import { fancyBluePanda20260218T223923 } from "./20260218T223923_fancy_blue_panda.js";
import { kindCrimsonFalcon20260218T235924 } from "./20260218T235924_kind_crimson_falcon.js";
export const migrations: Migration[] = [
	gentleAzureEagle20260206T174642,
	fancyGreenTiger20260206T180920,
	calmBluePhoenix20260211T100836,
	calmBlueDragon20260218T195452,
	fancyBluePanda20260218T223923,
	kindCrimsonFalcon20260218T235924,
];
