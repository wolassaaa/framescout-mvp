import { expect, test } from "@playwright/test";

test("switches every Task 4 review surface between Chinese and English", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("clipboard blocked by test")) }
    });
    document.execCommand = () => false;
  });
  await page.goto("/");

  await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

  await expect(page.getByRole("region", { name: "审阅台" })).toBeVisible();
  await expect(page.getByRole("region", { name: "已标记项目" })).toBeVisible();
  await expect(page.getByRole("button", { name: "辅助审阅", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "全部", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "淘汰复查", exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: "赛事故事" })).toBeAttached();
  await expect(page.getByText("保留场地、观众、氛围与叙事镜头。")).toBeVisible();

  await page.getByRole("button", { name: "添加标签" }).click();
  const chineseTagDialog = page.getByRole("dialog", { name: "添加标签" });
  await chineseTagDialog.getByRole("textbox").fill("subject:person");
  await chineseTagDialog.getByRole("button", { name: "添加", exact: true }).click();
  const chineseDecisionGroup = page.getByLabel("设置决定");
  await expect(chineseDecisionGroup).toBeVisible();
  await chineseDecisionGroup.getByRole("button", { name: /^精选\s+2$/ }).click();

  await page.getByRole("button", { name: "网格", exact: true }).click();
  await expect(page.getByRole("region", { name: "网格" })).toBeVisible();
  for (const label of ["需要复核", "无人主体", "焦点偏软", "已精选", "AI 已审", "等待 AI"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "标签", exact: true }).click();
  await expect(page.getByRole("region", { name: "标签与覆盖" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "让照片按创作语言被找到。" })).toBeVisible();

  await page.getByRole("button", { name: "项目", exact: true }).click();
  await expect(page.getByRole("region", { name: "项目" })).toBeVisible();
  await page.getByRole("button", { name: "导入", exact: true }).click();
  await expect(page.getByRole("region", { name: "新建审阅" })).toBeVisible();
  await expect(page.getByRole("button", { name: /赛事故事.*保留场地、观众、氛围与叙事镜头。/ })).toBeVisible();

  await page.getByRole("button", { name: "导出", exact: true }).click();
  await expect(page.getByRole("region", { name: "交付导出" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "整理给修图的可用文件。" })).toBeVisible();
  await page.getByRole("tab", { name: "标签 0" }).click();
  await expect(page.getByRole("button", { name: "人物 1" })).toBeVisible();
  await page.getByRole("textbox", { name: "交付位置" }).fill("C:\\FrameScout\\delivery");
  await page.getByRole("button", { name: "生成复制预览" }).click();
  await page.getByRole("button", { name: "重新读取拍摄信息" }).click();
  await expect(page.getByText("已开始从原始文件重新读取拍摄信息；完成后刷新导出预览即可看到新信息。")).toBeVisible();
  await page.getByRole("button", { name: "复制精选源路径" }).click();
  await expect(page.getByText("无法访问剪贴板。")).toBeVisible();

  await page.getByRole("button", { name: "显示缩放" }).click();
  await expect(page.getByRole("dialog", { name: "显示缩放" })).toBeVisible();
  await expect(page.getByRole("region", { name: "键盘快捷键" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "当前照片标签" })).toBeVisible();

  await page.getByRole("button", { name: "EN", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("region", { name: "Export hand-off" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Prepare files for retouching." })).toBeVisible();
  await expect(page.getByRole("button", { name: "Person 1" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Display scale" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Tag current frame" })).toBeVisible();
  await page.getByRole("button", { name: "Display scale" }).click();
  await page.getByRole("button", { name: "Refresh capture metadata" }).click();
  await expect(page.getByText("Metadata refresh started from the original files. Refresh the export preview when it completes.")).toBeVisible();
  await page.getByRole("button", { name: "Copy selected source paths" }).click();
  await expect(page.getByText("Clipboard access is unavailable.")).toBeVisible();

  await page.getByRole("button", { name: "Review Desk", exact: true }).click();
  await expect(page.getByRole("region", { name: "Review Desk" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Marked frames" })).toBeVisible();
  for (const label of ["Assisted", "All", "Reject audit"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "Grid", exact: true }).click();
  for (const label of ["Needs review", "No athlete", "Soft focus", "Selected", "AI reviewed", "Awaiting AI"]) {
    await expect(page.getByRole("button", { name: label, exact: true })).toBeVisible();
  }

  await page.getByRole("button", { name: "Tags", exact: true }).click();
  await expect(page.getByRole("region", { name: "Tags and coverage" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Find frames through the language of your work." })).toBeVisible();

  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page.getByRole("region", { name: "Projects" })).toBeVisible();
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.getByRole("region", { name: "New review" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Matchday story.*Preserve venue, crowd, atmosphere and story frames./ })).toBeVisible();
  await page.getByRole("button", { name: "Review Desk", exact: true }).click();
  await page.locator(".duel-entry").click();
  await expect(page.getByRole("region", { name: "Burst Duel" })).toBeVisible();
  await page.getByRole("button", { name: "Back to review" }).click();
});
