'use strict';
// 手动导入脚本后运行；只操作实际按钮和浏览器鼠标，不替换网页事件或脚本。
const realPage = require('./real-page.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
(async () => {
  const { page } = await realPage();
  const session = await page.context().newCDPSession(page);
  const scripts = [];
  session.on('Debugger.scriptParsed', event => { if (event.url.includes('userscript.html')) scripts.push(event); });
  await session.send('Debugger.enable');
  const localSource = fs.readFileSync(path.join(__dirname, '../dongchedi-360.user.js'), 'utf8');
  const controllerSource = source => source.slice(source.indexOf('  class NativeDragController {'), source.indexOf('  class ViewController {'));
  let nativeControllerSha256 = null;
  for (const event of scripts) {
    const { scriptSource } = await session.send('Debugger.getScriptSource', { scriptId: event.scriptId });
    if (!scriptSource.includes('class NativeDragController')) continue;
    if (controllerSource(scriptSource) !== controllerSource(localSource)) throw new Error('已安装的原生控制器与工作目录版本不同，请导入当前脚本');
    nativeControllerSha256 = crypto.createHash('sha256').update(controllerSource(scriptSource)).digest('hex');
  }
  if (!nativeControllerSha256) throw new Error('未找到已安装的助手脚本');
  let sandboxProbe = null;
  if (process.argv.includes('--probe')) {
    for (const event of scripts) {
      const { scriptSource } = await session.send('Debugger.getScriptSource', { scriptId: event.scriptId });
      const index = scriptSource.indexOf('const dispatch = (type, buttons)');
      if (index < 0) continue;
      const lineNumber = scriptSource.slice(0, index).split('\n').length - 1;
      await session.send('Debugger.setBreakpoint', { location: { scriptId: event.scriptId, lineNumber: lineNumber + 2 } });
    }
    session.on('Debugger.paused', async event => {
      const result = await session.send('Debugger.evaluateOnCallFrame', { callFrameId: event.callFrames[0].callFrameId, returnByValue: true, expression: '(function(){try {const e=new MouseEvent("mousemove",{view:window});return {ok:true,viewIsWindow:e.view===window};} catch(e){return {ok:false,error:e.message};}})()' });
      sandboxProbe = result.result.value;
      await session.send('Debugger.setSkipAllPauses', { skip: true });
      await session.send('Debugger.resume');
    });
  }
  const current = () => page.evaluate(() => [...document.querySelectorAll('[class*=series-360-image_frame-wrapper]')].findIndex(node => getComputedStyle(node).opacity === '1') + 1);
  const initial = await current();
  const toolbar = page.locator('[data-dcd360-owned=toolbar]');
  const panels = page.locator('[data-dcd360-owned=panels]');
  const targets = [['front', 5], ['frontRight', 9], ['right', 14], ['rearRight', 19], ['rear', 23], ['rearLeft', 27], ['left', 32], ['frontLeft', 1]];
  const results = [];
  for (const [key, expected] of targets) {
    if (!(await panels.locator('.panel[data-panel=view]').isVisible())) await toolbar.locator('[data-panel=view]').click();
    await panels.locator('[data-view=' + key + ']').click();
    await page.waitForFunction(expected => [...document.querySelectorAll('[class*=series-360-image_frame-wrapper]')].findIndex(node => getComputedStyle(node).opacity === '1') + 1 === expected, expected, { timeout: 6000 });
    await page.waitForFunction(() => !document.querySelector('[data-dcd360-owned=panels]').shadowRoot.querySelector('[data-download=current]').disabled);
    const actual = await current();
    if (actual !== expected) throw new Error('测试期间当前帧被其他交互改变，请在独立测试页重试');
    results.push({ key, expected, actual });
  }
  await page.keyboard.press('Escape');
  const root = page.locator('[class*=series-360-image_frame-wrapper]').first().locator('..');
  const rect = await root.boundingBox();
  await page.evaluate(() => { window.__dcdTrustedProof = []; const root = document.querySelector('[class*=series-360-image_frame-wrapper]').parentElement; for (const type of ['mousedown', 'mousemove', 'mouseup']) root.addEventListener(type, event => window.__dcdTrustedProof.push({ type, trusted: event.isTrusted }), { once: true }); });
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(rect.x + rect.width / 2 + 8, rect.y + rect.height / 2);
  await page.waitForTimeout(100);
  await page.mouse.up();
  const afterDrag = await current();
  const trustedEvents = await page.evaluate(() => { const result = window.__dcdTrustedProof; delete window.__dcdTrustedProof; return result; });
  if (afterDrag !== 2 || trustedEvents.some(event => !event.trusted)) throw new Error('原生连续鼠标拖拽未通过');
  await toolbar.locator('[data-panel=download]').click();
  const downloadMenu = await panels.locator('.panel[data-panel=download]').isVisible();
  const currentDownloadEnabled = await panels.locator('[data-download=current]').isEnabled();
  const evidence = { date: new Date().toISOString(), url: page.url(), installedUserscript: true, nativeControllerSha256, initial, results, afterDrag, trustedEvents, downloadMenu, currentDownloadEnabled, sandboxProbe };
  const evidenceDirectory = path.join(__dirname, '../test-results/evidence');
  fs.mkdirSync(evidenceDirectory, { recursive: true });
  fs.writeFileSync(path.join(evidenceDirectory, 'installed-native.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence, null, 2));
  await session.detach(); process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
