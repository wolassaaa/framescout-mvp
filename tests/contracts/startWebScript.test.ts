import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const script = readFileSync("scripts/start-web.ps1", "utf8");

describe("Web-first launcher", () => {
  it("builds current service and Web assets before launching", () => {
    expect(script).toContain("cargo build -p framescout-local-service --release");
    expect(script).toContain("npm run build");
  });

  it("waits for both health endpoints before opening the browser", () => {
    expect(script).toContain("http://127.0.0.1:4310/api/health");
    expect(script).toContain("http://127.0.0.1:5173/");
    expect(script).toContain("Wait-ForHttp");
    expect(script.indexOf('Wait-ForHttp -Url $serviceHealth')).toBeLessThan(script.indexOf('Start-Process $webUrl'));
    expect(script.indexOf('Wait-ForHttp -Url $webUrl')).toBeLessThan(script.indexOf('Start-Process $webUrl'));
  });

  it("keeps the service terminal visible and reports missing AI dependencies", () => {
    expect(script).toContain('"-NoExit"');
    expect(script).toContain("AI Python environment");
    expect(script).toContain("AI model");
  });
});
