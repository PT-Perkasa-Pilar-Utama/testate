import { render } from "@solidjs/web";

import { reportError } from "@/components/toast.tsx";
import { loadSession } from "@/lib/session.ts";
import App from "./app.tsx";
import "./styles/app.css";

const root = document.getElementById("root");
if (!(root instanceof HTMLElement)) throw new Error("#root is missing from index.html");

async function start(): Promise<void> {
  try {
    await loadSession();
  } catch (cause: unknown) {
    reportError(cause);
  }
}

void start();
render(() => <App />, root);
