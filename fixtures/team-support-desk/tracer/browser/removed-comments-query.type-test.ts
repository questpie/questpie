import type { SupportDesk } from "./questpie";

declare const desk: SupportDesk;

// @ts-expect-error comments are projected only through tickets.detail
void desk.queries["comments.page"];
