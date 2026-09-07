import { createRoot } from "react-dom/client";

import { AuthGate } from "./auth/gate";

const root = document.querySelector("#root");
if (!(root instanceof HTMLElement))
	throw new TypeError("Team Support Desk root is missing");
createRoot(root).render(<AuthGate />);
