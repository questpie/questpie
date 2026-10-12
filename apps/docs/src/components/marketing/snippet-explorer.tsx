"use client";

import { Tabs } from "@base-ui/react/tabs";
import { useState } from "react";

import { CodeSample } from "./code";

export type SnippetExplorerItem<TValue extends string = string> = {
	body: string;
	code: string;
	file: string;
	key: TValue;
	title: string;
};

export function SnippetExplorer<TValue extends string>({
	compact = false,
	items,
}: {
	compact?: boolean;
	items: readonly SnippetExplorerItem<TValue>[];
}) {
	const [activeItem, setActiveItem] = useState<TValue>(items[0].key);
	const [animateItem, setAnimateItem] = useState(false);

	return (
		<Tabs.Root
			className={`logic-tabs${compact ? " compact" : ""}`}
			data-animate={animateItem ? "true" : "false"}
			onKeyDownCapture={() => setAnimateItem(false)}
			onPointerDownCapture={() => setAnimateItem(true)}
			onValueChange={(value) => {
				if (typeof value !== "string") return;
				setActiveItem(value as TValue);
			}}
			orientation="vertical"
			value={activeItem}
		>
			<Tabs.List className="logic-tabs-list" activateOnFocus>
				{items.map((item, index) => (
					<Tabs.Tab className="logic-tab" key={item.key} value={item.key}>
						<span className="qp-eyebrow">0{index + 1}</span>
						<span>
							<strong>{item.title}</strong>
							<small>{item.body}</small>
						</span>
					</Tabs.Tab>
				))}
			</Tabs.List>
			<div className="logic-stage">
				{items.map((item) => (
					<Tabs.Panel
						className="logic-panel"
						keepMounted
						key={item.key}
						value={item.key}
					>
						<p className="qp-eyebrow">{item.file}</p>
						<CodeSample bare code={item.code} />
					</Tabs.Panel>
				))}
			</div>
		</Tabs.Root>
	);
}
