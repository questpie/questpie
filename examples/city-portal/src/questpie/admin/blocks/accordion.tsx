/**
 * Accordion / FAQ Block Renderer
 */

import { useState } from "react";

import type { BlockProps } from "../.generated/client";

type AccordionItem = {
	title: string;
	content: string;
};

export function AccordionRenderer({ values }: BlockProps<"accordion">) {
	const [openItems, setOpenItems] = useState<Set<number>>(new Set());
	const items = (values.items as AccordionItem[] | null) || [];

	const toggleItem = (index: number) => {
		setOpenItems((prev) => {
			const next = new Set(values.allowMultipleOpen ? prev : []);
			if (prev.has(index)) {
				next.delete(index);
			} else {
				next.add(index);
			}
			return next;
		});
	};

	return (
		<section className="px-6 py-16">
			<div className="container mx-auto max-w-3xl">
				{values.title && (
					<h2 className="mb-8 text-center text-3xl font-bold tracking-tight">
						{values.title}
					</h2>
				)}

				<div className="divide-y rounded-lg border">
					{items.map((item, index) => {
						const isOpen = openItems.has(index);
						return (
							<div key={`${item.title}-${index}`}>
								<button
									type="button"
									className="hover:bg-muted/50 flex w-full items-center justify-between px-6 py-4 text-left font-medium transition-colors"
									onClick={() => toggleItem(index)}
									aria-expanded={isOpen}
								>
									<span>{item.title}</span>
									<svg
										className={`h-5 w-5 transition-transform ${isOpen ? "rotate-180" : ""}`}
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
										aria-hidden="true"
									>
										<path
											strokeLinecap="round"
											strokeLinejoin="round"
											strokeWidth={2}
											d="M19 9l-7 7-7-7"
										/>
									</svg>
								</button>
								{isOpen && (
									<div className="text-muted-foreground px-6 pb-4">
										{item.content}
									</div>
								)}
							</div>
						);
					})}
				</div>

				{items.length === 0 && (
					<p className="text-muted-foreground text-center">
						No items added yet.
					</p>
				)}
			</div>
		</section>
	);
}
