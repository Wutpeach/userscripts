const { chromium } = require('playwright-core');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:18800');
  const page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('dongchedi.com/auto/series/'));
  const session = await page.context().newCDPSession(page);
  const scripts = [];
  session.on('Debugger.scriptParsed', e => { if (e.url.includes('userscript.html')) scripts.push(e); });
  await session.send('Debugger.enable');
  for (const event of scripts) {
    const { scriptSource: source } = await session.send('Debugger.getScriptSource', { scriptId: event.scriptId });
    const index = source.indexOf('const dispatch =');
    console.log(JSON.stringify({ id: event.scriptId, context: event.executionContextId, length: source.length, dispatch: source.slice(index, index + 420), reason: source.includes('result.reason'), tail: source.slice(-300) }));
  }
  console.log(JSON.stringify(await page.evaluate(() => ({ ui: !!document.querySelector('[data-dcd360-owned=toolbar]'), frame: [...document.querySelectorAll('[class*=series-360-image_frame-wrapper]')].findIndex(e => getComputedStyle(e).opacity === '1') + 1, feedback: document.querySelector('[data-dcd360-owned=panels]')?.shadowRoot?.querySelector('.feedback')?.textContent }))));
  await session.detach(); process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
