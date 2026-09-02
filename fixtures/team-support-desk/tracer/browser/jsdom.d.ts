declare module "jsdom" {
	export class JSDOM {
		constructor(html?: string, options?: Readonly<{ url?: string }>);
		readonly window: Window & typeof globalThis;
	}
}
