'use strict';
const realPage = require('./real-page.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');
const assert = require('node:assert/strict');
(async () => {
  const { browser, page } = await realPage();
  const inspector = await page.context().newCDPSession(page); const scripts = [];
  inspector.on('Debugger.scriptParsed', event => { if (event.url.includes('userscript.html')) scripts.push(event); });
  await inspector.send('Debugger.enable');
  let currentBuild = false;
  for (const event of scripts) {
    const { scriptSource } = await inspector.send('Debugger.getScriptSource', { scriptId: event.scriptId });
    if (scriptSource.includes('const viewFrameName =')) currentBuild = true;
  }
  await inspector.detach();
  if (!currentBuild) throw new Error('测试页仍是旧版脚本，请手动导入 1.1.3 后重新运行');
  const session = await browser.newBrowserCDPSession();
  const directory = path.resolve(__dirname, '../test-results/real-downloads');
  fs.mkdirSync(directory, { recursive: true });
  const started = new Map(); const results = [];
  let resolveDownload; let rejectDownload;
  session.on('Browser.downloadWillBegin', event => { started.set(event.guid, event.suggestedFilename); });
  session.on('Browser.downloadProgress', event => {
    if (event.state === 'completed' && started.has(event.guid)) resolveDownload?.(started.get(event.guid));
    if (event.state === 'canceled' && started.has(event.guid)) rejectDownload?.(new Error('浏览器取消了文件保存'));
  });
  const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const webp = bytes => bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length;
  try {
    await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory, eventsEnabled: true });
    const toolbar = page.locator('[data-dcd360-owned=toolbar]');
    const panels = page.locator('[data-dcd360-owned=panels]');
    if (!(await panels.locator('.panel[data-panel=download]').isVisible())) await toolbar.locator('[data-panel=download]').click();
    const current = await page.evaluate(() => [...document.querySelectorAll('[class*=series-360-image_frame-wrapper]')].findIndex(node => getComputedStyle(node).opacity === '1') + 1);
    const presets = { current: [current], four: [5, 14, 23, 32], eight: [5, 9, 14, 19, 23, 27, 32, 1], all: Array.from({ length: 36 }, (_, i) => i + 1) };
    const labels = { 1: '前左45°', 5: '正前方', 9: '前右45°', 14: '正右侧', 19: '后右45°', 23: '正后方', 27: '后左45°', 32: '正左侧' };
    const frameName = index => String(index).padStart(3, '0') + '.webp';
    const viewName = index => labels[index] ? labels[index] + '.webp' : frameName(index);
    for (const kind of Object.keys(presets)) {
      let timer;
      const waiting = new Promise((resolve, reject) => {
        resolveDownload = resolve; rejectDownload = reject;
        timer = setTimeout(() => reject(new Error('真实下载未在 90 秒内完成')), 90000);
      });
      // 即使 click 失败也已有拒绝处理，避免超时 Promise 成为未处理异常。
      waiting.catch(() => {});
      try {
        await panels.locator('[data-download=' + kind + ']').click();
        const name = await waiting;
        const bytes = fs.readFileSync(path.join(directory, name));
        const result = { kind, name, size: bytes.length, sha256: sha(bytes), files: [] };
        if (kind === 'current') {
          assert(webp(bytes)); assert.equal(name, '懂车帝车辆_' + viewName(current));
          result.files.push({ index: current, name: viewName(current), sha256: sha(bytes) });
        } else {
          const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
          assert.deepEqual(Object.keys(zip.files), presets[kind].map(kind === 'all' ? frameName : viewName));
          for (const filename of Object.keys(zip.files)) {
            const data = await zip.file(filename).async('nodebuffer'); assert(webp(data));
            result.files.push({ index: presets[kind][result.files.length], name: filename, sha256: sha(data) });
          }
          let offset = 0;
          for (const file of result.files) {
            assert.equal(bytes.readUInt32LE(offset), 0x04034b50); assert.equal(bytes.readUInt16LE(offset + 8), 0);
            offset += 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28) + bytes.readUInt32LE(offset + 18);
          }
        }
        await page.waitForFunction(() => !document.querySelector('[data-dcd360-owned=panels]').shadowRoot.querySelector('[data-download=current]').disabled);
        results.push(result); console.log(kind + ': ' + name + ', ' + result.files.length + ' files, ' + bytes.length + ' bytes');
      } finally { clearTimeout(timer); resolveDownload = null; rejectDownload = null; }
    }
    const all = new Map(results.at(-1).files.map(file => [file.index, file.sha256]));
    for (const result of results) for (const file of result.files) assert.equal(file.sha256, all.get(file.index));
    const version = require('../package.json').version;
    const evidence = { version, date: new Date().toISOString(), url: page.url(), installedUserscript: true, results, crossArchiveHashesMatch: true };
    const evidenceDirectory = path.join(__dirname, '../test-results/evidence');
    fs.mkdirSync(evidenceDirectory, { recursive: true });
    fs.writeFileSync(path.join(evidenceDirectory, 'installed-downloads.json'), JSON.stringify(evidence, null, 2));
    console.log('实际下载、CRC32、STORE、文件顺序、WebP 签名及跨压缩包字节一致性全部通过');
  } finally {
    await session.send('Browser.setDownloadBehavior', { behavior: 'default' }); await session.detach();
  }
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
