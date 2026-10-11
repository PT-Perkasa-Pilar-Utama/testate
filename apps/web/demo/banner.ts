/** The strip that says this is a demo, what it cannot do, and how to sign in again (#demo). */
type Account = { username: string; password: string };

// Bottom left of the content: clear of the 240px sidebar and of the toasts on the right.
const CSS = `
.demo-banner{position:fixed;bottom:12px;left:252px;z-index:60;max-width:min(420px,calc(100vw - 264px));
  padding:10px 14px;border-radius:10px;font:13px/1.45 'Mona Sans',system-ui,sans-serif;background:#0b1017;
  color:#eef2f5;box-shadow:0 0 0 1px rgba(238,242,245,.16),0 12px 32px rgba(0,0,0,.4)}
.demo-banner a{color:#7dd3c0}.demo-banner summary{cursor:pointer;color:#8b96a3}
.demo-banner p{margin:8px 0 0}.demo-banner .muted{color:#8b96a3}
@media (max-width:640px){.demo-banner{left:12px;max-width:calc(100vw - 24px)}}`;

export function showBanner(admin: Account, others: readonly Account[]): void {
  const style = document.createElement("style");
  style.textContent = CSS;
  const box = document.createElement("aside");
  box.className = "demo-banner";
  box.setAttribute("aria-label", "About this demo");
  const accounts = [admin, ...others]
    .map((account) => `<code>${account.username}</code> / <code>${account.password}</code>`)
    .join("<br>");
  box.innerHTML = `
    <strong style="color:#7dd3c0">Demo</strong> · runs in your browser. Nothing leaves this tab; reload to start over.
    <details><summary>Accounts and limits</summary>
      <p>${accounts}</p>
      <p class="muted">The databases and servers are samples inside the page. Connecting your own, agents over MCP,
      XLSX files and the remote log engines need a real Testate.
      <a href="https://pt-perkasa-pilar-utama.github.io/testate/#get">Install it</a>.</p>
    </details>`;
  document.head.append(style);
  document.body.append(box);
}
