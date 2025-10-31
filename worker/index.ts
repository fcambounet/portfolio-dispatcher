export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response("OK");
    // Here you'd verify HMAC signature with WEBHOOK_SECRET (like your other project)
    const event = req.headers.get("X-GitHub-Event") || "unknown";
    if (event === "pull_request") {
      // TODO: call GitHub API to label/comment PR with ROUTE_LABEL to trigger your workflows
    }
    return new Response("ACK");
  }
} satisfies ExportedHandler;