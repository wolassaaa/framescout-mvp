const { chromium } = require("playwright");

const url = process.argv[2] || "http://127.0.0.1:5175/";

(async () => {
  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--enable-precise-memory-info"]
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const navigationStarted = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.locator(".topbar-ready").filter({ hasText: "1000" }).waitFor({ timeout: 60_000 });
  const readyMs = Date.now() - navigationStarted;

  await page.getByRole("button", { name: /^(网格|Grid)$/ }).click();
  await page.locator("button.contact-thumb").first().waitFor({ timeout: 30_000 });
  await page.locator(".contact-sheet").evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await page.waitForTimeout(1_000);

  const images = await page.locator("img").evaluateAll((nodes) => nodes.slice(0, 40).map((image) => ({
    complete: image.complete,
    width: image.naturalWidth,
    src: image.currentSrc || image.src
  })));
  const switchStarted = Date.now();
  await page.getByRole("button", { name: /^(标签|Tags)$/ }).click();
  await page.getByRole("button", { name: /^(审阅台|Review Desk)$/ }).click();
  const switchMs = Date.now() - switchStarted;
  const memory = await page.evaluate(() => {
    const value = performance.memory;
    return value ? {
      usedJSHeapSize: value.usedJSHeapSize,
      totalJSHeapSize: value.totalJSHeapSize,
      jsHeapSizeLimit: value.jsHeapSizeLimit
    } : null;
  });

  process.stdout.write(`${JSON.stringify({
    readyMs,
    switchMs,
    usedHeapMB: memory ? Math.round(memory.usedJSHeapSize / 1024 / 1024 * 10) / 10 : null,
    totalHeapMB: memory ? Math.round(memory.totalJSHeapSize / 1024 / 1024 * 10) / 10 : null,
    sampledImages: images.length,
    loadedImages: images.filter((image) => image.complete && image.width > 0).length,
    brokenImages: images.filter((image) => !image.complete || image.width === 0),
    consoleErrors
  })}\n`);
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
