/**
 * Accordion / FAQ Block Renderer
 */

import type { BlockComponentProps } from "@questpie/admin/client";
import { useState } from "react";
import type { AppCMS } from "@/questpie/server/cms";

type AccordionItem = {
	title: string;
	content: string;
};

export function AccordionRenderer({
	values,
}: BlockComponentProps<AppCMS, "accordion">) {
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
		<section className="py-16 px-6">
			<div className="container mx-auto max-w-3xl">
				{values.title && (
					<h2 className="text-3xl font-bold tracking-tight mb-8 text-center">
						{values.title}
					</h2>
				)}

				<div className="divide-y border rounded-lg">
					{items.map((item, index) => {
						const isOpen = openItems.has(index);
						return (
							<div key={`${item.title}-${index}`}>
								<button
									type="button"
									className="w-full flex items-center justify-between px-6 py-4 text-left font-medium hover:bg-muted/50 transition-colors"
									onClick={() => toggleItem(index)}
									aria-expanded={isOpen}
								>
									<span>{item.title}</span>
									<svg
										className={`w-5 h-5 transition-transform ${isOpen ? "rotate-180" : ""}`}
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
									<div className="px-6 pb-4 text-muted-foreground">
										{item.content}
									</div>
								)}
							</div>
						);
					})}
				</div>

				{items.length === 0 && (
					<p className="text-center text-muted-foreground">
						No items added yet.
					</p>
				)}
			</div>
		</section>
	);
}
