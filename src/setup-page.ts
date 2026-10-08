function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

function body(workerName: string): string {
  return `
      <h1>Chat AX isn't set up yet</h1>
      <p>This Worker only serves people who sign in with Cloudflare Access, and no Access application is configured for it, so it refuses every request.</p>
      <p>From your clone of the repository, run:</p>
      <pre><code>npm run setup</code></pre>
      <p>It creates the Access application, chooses who can sign in, and redeploys <code>${escapeHtml(workerName)}</code> locked to it.</p>
      <p class="note">Already have an Access application for this hostname? Set its team domain and audience tag as the Worker secrets <code>CF_ACCESS_ISS</code> and <code>CF_ACCESS_AUD</code>.</p>`;
}

export function setupPage(workerName: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Set up Chat AX</title>
<style>
  :root { color-scheme: light dark; --bg: #fafafa; --panel: #fff; --text: #171717; --muted: #5c5c5c; --border: #e3e3e3; --accent: #f38020; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0f0f0f; --panel: #1a1a1a; --text: #f5f5f5; --muted: #a3a3a3; --border: #2e2e2e; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, sans-serif; }
  main { width: min(640px, calc(100vw - 32px)); padding: 32px; border: 1px solid var(--border); border-radius: 16px; background: var(--panel); box-sizing: border-box; }
  h1 { margin: 4px 0 12px; font-size: 26px; line-height: 1.2; }
  li { margin: 8px 0; }
  code { font: 14px ui-monospace, monospace; overflow-wrap: anywhere; }
  pre { padding: 14px 16px; border-radius: 10px; background: var(--bg); border: 1px solid var(--border); overflow-x: auto; }
  .note { color: var(--muted); font-size: 14px; }
  a { color: inherit; }
</style>
</head>
<body><main>${body(workerName)}</main></body>
</html>`;
}
