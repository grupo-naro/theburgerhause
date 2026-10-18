import { describe, expect, it } from "vitest";
import { createCspReportHandler, MAX_BODY_BYTES, violatedDirective } from "./csp-report";

const post = (body: string, ip = "203.0.113.1", headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/csp-report", {
    method: "POST",
    body,
    headers: { "content-type": "application/csp-report", "x-forwarded-for": ip, ...headers },
  });

const setup = (perMinute?: number) => {
  const lines: string[] = [];
  return { lines, POST: createCspReportHandler({ perMinute, log: (l) => lines.push(l) }) };
};

describe("POST /api/csp-report", () => {
  it("answers 204 and logs one fixed line with only the violated directive", async () => {
    const { POST, lines } = setup();
    const body = JSON.stringify({
      "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://evil.example/x.png?secret=1", "document-uri": "http://x/pedido/TOKEN" },
    });
    const res = await POST(post(body));
    expect(res.status).toBe(204);
    expect(lines).toEqual(["[csp] violation report (img-src)"]);
    expect(lines.join("")).not.toContain("evil");
    expect(lines.join("")).not.toContain("TOKEN");
  });

  it("an unknown or malformed body is still a plain 204 with no directive and no content in the log", async () => {
    const { POST, lines } = setup();
    expect((await POST(post("not json <script>"))).status).toBe(204);
    expect((await POST(post(JSON.stringify({ "csp-report": { "effective-directive": "evil\nINJECT" } })))).status).toBe(204);
    expect(lines).toEqual(["[csp] violation report", "[csp] violation report"]);
  });

  it("rejects oversized bodies (declared and undeclared) without parsing them", async () => {
    const { POST, lines } = setup();
    const big = "x".repeat(MAX_BODY_BYTES + 1);
    expect((await POST(post(big, "203.0.113.2", { "content-length": String(big.length) }))).status).toBe(413);
    expect((await POST(post(big, "203.0.113.3"))).status).toBe(204); // no usable Content-Length: capped read, logged as unknown
    expect(lines).toEqual(["[csp] violation report"]);
  });

  it("is rate limited per IP", async () => {
    const { POST } = setup(3);
    const statuses = [];
    for (let i = 0; i < 5; i++) statuses.push((await POST(post("{}", "203.0.113.4"))).status);
    expect(statuses).toEqual([204, 204, 204, 429, 429]);
    expect((await POST(post("{}", "203.0.113.5"))).status).toBe(204);
  });

  it("violatedDirective reads report-uri and Reporting API shapes", () => {
    expect(violatedDirective({ "csp-report": { "violated-directive": "script-src-elem 'self'" } })).toBe("script-src-elem");
    expect(violatedDirective([{ body: { effectiveDirective: "style-src" } }])).toBe("style-src");
    expect(violatedDirective(null)).toBeNull();
    expect(violatedDirective("x")).toBeNull();
  });
});
