const { chromium } = require("playwright");

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  const failedResponses = [];
  const failedRequests = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400) failedResponses.push({ status: response.status(), url: response.url() });
  });
  page.on("requestfailed", (request) => failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
  const response = await page.goto("http://127.0.0.1:5173/", {
    waitUntil: "networkidle",
    timeout: 30_000
  });
  await page.locator("button.analysis-profile-trigger").click();
  const radios = await page.getByRole("radio").count();
  const apiKeyFields = await page.getByLabel(/API Key/i).count();
  const privacyVisible = await page.getByText(/RAW/).filter({ hasText: /本机|local/i }).first().isVisible().catch(() => false);
  const imageCount = Math.min(await page.locator("img").count(), 20);
  for (let index = 0; index < imageCount; index += 1) {
    await page.locator("img").nth(index).scrollIntoViewIfNeeded().catch(() => undefined);
  }
  await page.waitForTimeout(1_000);
  const images = await page.locator("img").evaluateAll((nodes) => nodes.slice(0, 20).map((image) => ({
    complete: image.complete,
    width: image.naturalWidth,
    src: image.currentSrc || image.src
  })));
  const loadedImages = images.filter((image) => image.complete && image.width > 0).length;
  process.stdout.write(`${JSON.stringify({
    status: response?.status(),
    radios,
    apiKeyFields,
    privacyVisible,
    sampledImages: images.length,
    loadedImages,
    brokenImages: images.filter((image) => !image.complete || image.width === 0),
    failedResponses,
    failedRequests,
    consoleErrors: errors
  }, null, 2)}\n`);
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
