'use strict';
// 可选的真站验收辅助：只连接 Cindy status 已确认的独立自动化浏览器。
// 不启动/安装浏览器、不读取登录凭据、不自动点击网页、不安装用户脚本。
const { chromium } = require('playwright-core');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const JSZip = require('jszip');
(async () => {
  const browser = await chromium.connectOverCDP(process.env.DCD360_CDP || 'http://127.0.0.1:18800');
  const session = await browser.newBrowserCDPSession();
  const directory = path.resolve(__dirname, '../test-results/real-downloads');
  fs.mkdirSync(directory, { recursive: true });
  const expected = Number(process.env.DCD360_DOWNLOAD_COUNT || 4);
  const active = new Map(); const results = [];
  let finishing = false;
  const finish = async (code) => {
    if (finishing) return; finishing = true;
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(results, null, 2));
    await session.send('Browser.setDownloadBehavior', { behavior: 'default' });
    await session.detach(); process.exit(code);
  };
  session.on('Browser.downloadWillBegin', (event) => {
    if (!event.suggestedFilename.startsWith('懂车帝车辆_')) return;
    active.set(event.guid, event.suggestedFilename); console.log('started ' + event.suggestedFilename);
  });
  session.on('Browser.downloadProgress', async (event) => {
    const name = active.get(event.guid); if (!name) return;
    if (event.state === 'canceled') { results.push({ name, status: 'canceled' }); await finish(1); return; }
    if (event.state !== 'completed') return;
    active.delete(event.guid);
    try {
      const bytes = fs.readFileSync(path.join(directory, name));
      const info = { name, status: 'completed', bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
      const webp = (buffer) => buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP' && buffer.readUInt32LE(4) + 8 === buffer.length;
      if (name.endsWith('.zip')) {
        const zip = await JSZip.loadAsync(bytes, { checkCRC32: true }); info.files = Object.keys(zip.files); info.validWebP = true;
        for (const filename of info.files) if (!webp(await zip.file(filename).async('nodebuffer'))) info.validWebP = false;
      } else info.validWebP = webp(bytes);
      results.push(info); console.log(JSON.stringify(info));
      if (results.length >= expected) await finish(results.every((item) => item.validWebP) ? 0 : 1);
    } catch (error) { console.error(error); await finish(1); }
  });
  await session.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: directory, eventsEnabled: true });
  console.log('ready ' + directory);
  setTimeout(() => finish(2), 180000);
  process.on('SIGINT', () => finish(2));
})().catch((error) => { console.error(error); process.exit(1); });
