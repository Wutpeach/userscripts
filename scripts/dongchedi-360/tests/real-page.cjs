'use strict';
const { chromium } = require('playwright-core');
module.exports = async () => {
  const browser = await chromium.connectOverCDP(process.env.DCD360_CDP || 'http://127.0.0.1:18800');
  const pages = browser.contexts().flatMap(context => context.pages());
  let page = pages.find(page => page.url().includes('dongchedi.com/auto/series/') && page.url().endsWith('#dcd360-verification'));
  if (!page) {
    const original = pages.find(page => page.url().startsWith('https://www.dongchedi.com/auto/series/'));
    if (!original) throw new Error('没有当前懂车帝详情页');
    page = await original.context().newPage();
    const url = new URL(original.url()); url.hash = 'dcd360-verification';
    await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  } else await page.reload({ waitUntil: 'domcontentloaded' });
  // 真站初始只挂载少量帧，鼠标进入原生视口后才补齐 36 帧。
  if (!(await page.locator('[data-dcd360-owned=toolbar]').count())) {
    await page.locator('[class*=series-360-image_frame-wrapper]').first().locator('..').hover();
  }
  await page.locator('[data-dcd360-owned=toolbar]').waitFor({ timeout: 20000 });
  return { browser, page };
};
