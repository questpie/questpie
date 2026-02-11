import type { Migration } from "questpie";

import { gentleAzureEagle20260206T174642 } from "./20260206T174642_gentle_azure_eagle.js";
import { fancyGreenTiger20260206T180920 } from "./20260206T180920_fancy_green_tiger.js";
import { calmBluePhoenix20260211T100836 } from "./20260211T100836_calm_blue_phoenix.js";
export const migrations: Migration[] = [
  gentleAzureEagle20260206T174642,
  fancyGreenTiger20260206T180920,
  calmBluePhoenix20260211T100836,
];
