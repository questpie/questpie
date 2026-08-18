import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { StudioApp } from "./app";

import "./styles.css";

const host = document.querySelector("#studio");
if (!host) throw new Error("Studio host element is missing");

createRoot(host).render(
	<StrictMode>
		<StudioApp />
	</StrictMode>,
);
