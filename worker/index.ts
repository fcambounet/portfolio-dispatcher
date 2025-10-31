const PROJECT = (globalThis as any).PROJECT || "portfolio-agents";
const ROUTE_LABEL = (globalThis as any).ROUTE_LABEL || "run:portfolio";

function te(s: string) { return new TextEncoder().encode(s); }

async function verifyGithubSignature(req: Request, secret: string): Promise<{ ok: boolean; body: string }> {
  const sig = req.headers.get("x-hub-signature-256") || "";
  const body = await req.text();
  if (!sig.startsWith("sha256=")) return { ok: false, body };
  const key = await crypto.subtle.importKey("raw", te(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const h = await crypto.subtle.sign("HMAC", key, te(body));
  const hex = Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
  const expected = "sha256=" + hex;
  const ok = expected === sig;
  return { ok, body };
}

async function addLabel(token: string, owner: string, repo: string, issueNumber: number, label: string) {
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/labels`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "portfolio-dispatcher"
    },
    body: JSON.stringify({ labels: [label] })
  });
  const txt = await res.text();
  console.log(`GitHub label response ${res.status}: ${txt.slice(0,120)}`);
  if (!res.ok) throw new Error(`GitHub label error ${res.status}`);
}

export default {
  async fetch(req: Request, env: { WEBHOOK_SECRET: string; GITHUB_TOKEN: string }): Promise<Response> {
    if (req.method !== "POST") return new Response("OK");
    const event = req.headers.get("x-github-event") || "unknown";
    const delivery = req.headers.get("x-github-delivery") || "n/a";
    console.log(`[${PROJECT}] received event=${event} delivery=${delivery}`);

    const { ok, body } = await verifyGithubSignature(req, env.WEBHOOK_SECRET);
    if (!ok) { console.log("invalid signature"); return new Response("invalid signature", { status: 401 }); }

    const payload: any = JSON.parse(body);
    const owner = payload.repository?.owner?.login;
    const repo = payload.repository?.name;

    if (event === "pull_request") {
      const pr = payload.pull_request?.number;
      const action = payload.action;
      console.log(`PR action=${action} owner=${owner} repo=${repo} pr=${pr}`);
      if (owner && repo && pr && ["opened", "synchronize", "reopened"].includes(action)) {
        await addLabel(env.GITHUB_TOKEN, owner, repo, pr, ROUTE_LABEL);
        console.log(`Labeled PR #${pr} with ${ROUTE_LABEL}`);
      }
    }

    if (event === "issue_comment") {
      const bodyText: string = payload.comment?.body || "";
      const pr = payload.issue?.number;
      console.log(`Comment on issue/pr #${pr}: ${bodyText.slice(0,80)}`);
      if (owner && repo && pr && /\/run\s+portfolio/i.test(bodyText)) {
        await addLabel(env.GITHUB_TOKEN, owner, repo, pr, ROUTE_LABEL);
        console.log(`Command → labeled #${pr} with ${ROUTE_LABEL}`);
      }
    }
    return new Response("ACK");
  }
} satisfies ExportedHandler;
