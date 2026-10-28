'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const JSZip = require('jszip');

const source = fs.readFileSync(path.join(__dirname, '../dongchedi-360.user.js'), 'utf8');
const zipSource = fs.readFileSync(require.resolve('jszip/dist/jszip.min.js'), 'utf8');
const script = source.replace('  app.start();', '  window.__test = { app, imageURL, safeName }; app.start();');
let browser;
let images;
const baseURL = 'https://www.dongchedi.com/auto/series/18';

before(async () => {
  const executablePath = process.env.DCD360_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage();
  // 仅用于生成有 Alpha 的测试输入；正式脚本没有 Canvas 下载代码。
  images = await page.evaluate(() => Array.from({ length: 36 }, (_, i) => {
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 8;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(' + (i * 7) + ',' + (255 - i * 5) + ',80,.4)'; ctx.fillRect(1, 1, 6, 6);
    return canvas.toDataURL('image/webp', 1).split(',')[1];
  }));
  await page.close();
});
after(async () => { await browser?.close(); });

function frames(count = 36, color = 'blue') {
  return Array.from({ length: count }, (_, i) => '<div class="series-360-image_frame-wrapper__TEST" style="opacity:' + (i === 1 ? 1 : 0) + '"><img draggable="false" src="//p3.dcarimg.com/img/tos-cn-i-dcdx/' + color + '-' + String(i + 1).padStart(3, '0') + '~1200x0.webp"></div>').join('');
}
function viewport(count = 36, id = 'vehicle', hidden = false) {
  return '<section class="vehicle" id="' + id + '" ' + (hidden ? 'hidden' : '') + '><div class="root-wrapper">' + frames(count) + '</div><div class="toolbar"><button class="native-fullscreen">全屏</button></div></section>';
}
const css = 'body{margin:24px;font:14px system-ui;background:#f7f8fa}.vehicle{width:720px;max-width:95vw;overflow:hidden;border-radius:8px}.vehicle:fullscreen{width:100vw;background:#f7f8fa}.root-wrapper{height:360px;position:relative;background:#eceef1}.series-360-image_frame-wrapper__TEST{position:absolute;inset:0}.root-wrapper img{width:100%;height:100%;object-fit:contain}.toolbar{display:flex;align-items:center;gap:12px;padding:12px;background:white}.native-fullscreen{font:14px system-ui;border:0;background:none;padding:3px;color:#555}';

async function fixture(t, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1000, height: 780 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  t.after(async () => { await context.close(); assert.deepEqual(errors, [], '脚本不应产生未处理的浏览器异常'); });
  await page.route('https://p3.dcarimg.com/**', (route) => {
    const index = Math.max(0, Number(route.request().url().match(/-(\d{3})~/)?.[1] || 1) - 1);
    return route.fulfill({ contentType: 'image/webp', body: Buffer.from(images[index % 36], 'base64') });
  });
  await page.route('https://www.dongchedi.com/**', (route) => route.fulfill({
    contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' + (options.html ?? viewport()) + '<p id="outside">页面其他区域</p></body></html>',
  }));
  await page.goto(baseURL);
  await page.evaluate(({ images, nativeMode }) => {
    window.mock = { requests: [], saved: [], active: 0, maxActive: 0, failures: {}, invalid: [], truncated: [], timeouts: [], silent: [], delay: 20, saveMode: 'success', aborted: 0, nativeIndex: 1 };
    window.GM_xmlhttpRequest = (details) => {
      const mock = window.mock;
      const index = Number(details.url.match(/-(\d{3})~/)[1]) - 1;
      mock.requests.push({ url: details.url, index }); mock.active++; mock.maxActive = Math.max(mock.maxActive, mock.active);
      let ended = false;
      const finish = () => { if (ended) return false; ended = true; mock.active--; return true; };
      const timer = setTimeout(() => {
        if (mock.silent.includes(index)) return;
        if (!finish()) return;
        if (mock.timeouts.includes(index)) { details.ontimeout(); return; }
        if ((mock.failures[index] || 0) > 0) { mock.failures[index]--; details.onload({ status: 503 }); return; }
        let bytes = Uint8Array.from(atob(images[index]), (char) => char.charCodeAt(0));
        if (mock.invalid.includes(index)) bytes = new TextEncoder().encode('<html>not an image</html>');
        if (mock.truncated.includes(index)) bytes = bytes.slice(0, -3);
        details.onload({ status: 200, response: bytes.buffer, finalUrl: details.url });
      }, mock.delay + (index % 4) * 3);
      return { abort: () => { if (finish()) { clearTimeout(timer); mock.aborted++; details.onabort(); } } };
    };
    document.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[download]');
      if (!link || !link.href.startsWith('blob:')) return;
      if (mock.saveMode !== 'browser') event.preventDefault();
      fetch(link.href).then(response => response.arrayBuffer()).then(buffer => {
        mock.saved.push({ name: link.download, bytes: Array.from(new Uint8Array(buffer)) });
      });
    }, true);
    window.setNative = (index) => {
      mock.nativeIndex = ((index % 36) + 36) % 36;
      document.querySelectorAll('#vehicle .root-wrapper > div').forEach((node, i) => { node.style.opacity = i === mock.nativeIndex ? '1' : '0'; });
    };
    window.bindNative = (root) => {
      if (!root) return;
      let x = 0;
      root.addEventListener('mousedown', (event) => { x = Math.round(event.clientX); mock.nativePressed = true; });
      root.addEventListener('mousemove', (event) => {
        if (!mock.nativePressed || nativeMode === 'none') return;
        const delta = Math.round(event.clientX) - x;
        if (Math.abs(delta) > 4) {
          const step = Math.sign(delta) * (nativeMode === 'reverse' ? -1 : nativeMode === 'double' ? 2 : 1);
          setNative(mock.nativeIndex + step); x = Math.round(event.clientX);
        }
      });
      root.addEventListener('mouseup', () => { mock.nativePressed = false; });
    };
    bindNative(document.querySelector('#vehicle .root-wrapper'));
    document.querySelectorAll('.native-fullscreen').forEach((button) => button.addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen(); else button.closest('section').requestFullscreen();
    }));
  }, { images, nativeMode: options.nativeMode || 'normal' });
  if (!options.noZip) await page.addScriptTag({ content: zipSource });
  await page.addScriptTag({ content: script });
  if (options.available !== false) await available(page);
  return page;
}
const toolbar = (page) => page.locator('[data-dcd360-owned="toolbar"]');
const panel = (page, key) => page.locator('[data-dcd360-owned="panels"]').locator('.panel[data-panel="' + key + '"]');
const trigger = (page, key) => toolbar(page).locator('button[data-panel="' + key + '"]');
async function available(page) {
  try { await toolbar(page).waitFor({ state: 'visible', timeout: 8000 }); }
  catch (error) {
    console.error(await page.evaluate(() => {
      const root = document.querySelector('.root-wrapper'); const img = root?.querySelector('img');
      return { url: img?.getAttribute('src'), normalized: __test.imageURL(img?.getAttribute('src')), frames: root && __test.app.adapter.readFrames(root)?.length, toolbar: root && __test.app.adapter.findToolbar(root)?.anchor.outerHTML, pending: __test.app.pending?.signature, data: !!__test.app.manager.data, html: document.body.innerHTML.slice(-800) };
    }));
    throw error;
  }
}
async function menu(page, key) {
  if (!(await panel(page, key).isVisible())) await trigger(page, key).click();
}
async function until(page, expression) { await page.waitForFunction(expression, undefined, { timeout: 8000 }); }
async function download(page, kind) {
  const before = await page.evaluate(() => mock.saved.length);
  await menu(page, 'download'); await page.locator('[data-download="' + kind + '"]').click();
  await page.waitForFunction((count) => mock.saved.length > count, before);
  await until(page, () => !__test.app.downloads.task);
  return page.evaluate(() => mock.saved.at(-1));
}
async function verifyZip(saved, indices, names = indices.map((index) => String(index + 1).padStart(3, '0') + '.webp')) {
  const bytes = Buffer.from(saved.bytes); const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  assert.deepEqual(Object.keys(zip.files), names);
  for (let i = 0; i < indices.length; i++) assert.deepEqual(await zip.file(names[i]).async('nodebuffer'), Buffer.from(images[indices[i]], 'base64'));
  // 检查每个本地文件头的压缩方法为 STORE（0）。
  let offset = 0;
  for (let i = 0; i < indices.length; i++) {
    assert.equal(bytes.readUInt32LE(offset), 0x04034b50); assert.equal(bytes.readUInt16LE(offset + 8), 0);
    assert.equal(bytes.readUInt16LE(offset + 6) & 0x0800, 0x0800, '本地文件头必须声明 UTF-8');
    offset += 30 + bytes.readUInt16LE(offset + 26) + bytes.readUInt16LE(offset + 28) + bytes.readUInt32LE(offset + 18);
  }
  for (let i = 0; i < indices.length; i++) {
    assert.equal(bytes.readUInt32LE(offset), 0x02014b50);
    assert.equal(bytes.readUInt16LE(offset + 8) & 0x0800, 0x0800, '中央目录必须声明 UTF-8');
    offset += 46 + bytes.readUInt16LE(offset + 28) + bytes.readUInt16LE(offset + 30) + bytes.readUInt16LE(offset + 32);
  }
}

test('完整序列：同容器、DOM 顺序、当前第 2 帧、HTTPS 与工具栏邻接', async (t) => {
  const page = await fixture(t, { html: viewport() + viewport(36, 'hidden', true) });
  const state = await page.evaluate(() => ({
    count: __test.app.manager.data.frames.length, current: __test.app.manager.current(),
    urls: __test.app.manager.snapshot().urls,
    adjacent: document.querySelector('.native-fullscreen').nextElementSibling?.dataset.dcd360Owned,
    controls: document.querySelector('[data-dcd360-owned="toolbar"]').shadowRoot.querySelectorAll('button').length,
  }));
  assert.equal(state.count, 36); assert.equal(state.current, 1); assert.equal(state.adjacent, 'toolbar'); assert.equal(state.controls, 2);
  assert(state.urls.every((url, i) => url.startsWith('https://p3.dcarimg.com/') && url.includes('-' + String(i + 1).padStart(3, '0') + '~1200x0.webp')));
  await page.evaluate(() => { for (let i = 0; i < 15; i++) document.querySelector('#outside').append(document.createElement('span')); });
  await page.waitForTimeout(400); assert.equal(await toolbar(page).count(), 1);
});

test('拒绝残缺、重复、混杂域名、多个视口、无工具栏和非外观模式', async (t) => {
  const cases = [
    ['35 帧', viewport(35)], ['37 帧', viewport(37)],
    ['两个残缺容器不能拼成 36', viewport(18) + viewport(18, 'second')],
    ['两个可见完整视口', viewport() + viewport(36, 'second')],
    ['重复 URL', viewport().replace('blue-036', 'blue-035')],
    ['非允许域名', viewport().replace('p3.dcarimg.com', 'evil.example')],
    ['无全屏工具栏', viewport().replace('>全屏<', '>其他<')],
    ['内饰模式/隐藏外观', viewport(36, 'vehicle', true)],
    ['当前帧不唯一', viewport().replace('style="opacity:0"', 'style="opacity:1"')],
    ['类名前缀不匹配', viewport().replaceAll('series-360-image_frame-wrapper__TEST', 'fake-series-360-image_frame-wrapper__TEST')],
  ];
  for (const [name, html] of cases) await t.test(name, async (st) => {
    const page = await fixture(st, { html, available: false });
    await page.waitForTimeout(500); assert.equal(await toolbar(page).count(), 0);
    await assert.rejects(page.evaluate(() => __test.app.manager.snapshot()), /不足 36/);
  });
});

test('八方向原生切换：内部状态同步，切换后继续鼠标拖拽，无预览覆盖层', async (t) => {
  const page = await fixture(t);
  await menu(page, 'view');
  for (const [key, frame] of Object.entries({ front: 5, frontRight: 9, right: 14, rearRight: 19, rear: 23, rearLeft: 27, left: 32, frontLeft: 1 })) {
    await page.locator('[data-view="' + key + '"]').click();
    await until(page, () => __test.app.views.current() >= 0);
    assert.equal(await page.evaluate(() => __test.app.views.current()), frame - 1);
    assert.equal(await page.evaluate(() => mock.nativeIndex), frame - 1);
    assert.equal(await page.locator('[data-view="' + key + '"]').getAttribute('aria-pressed'), 'true');
  }
  assert.equal(await page.evaluate(() => mock.requests.length), 0);
  await page.locator('[data-view="front"]').click();
  await until(page, () => __test.app.views.current() >= 0);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('[data-dcd360-owned="preview"]').count(), 0);
  const box = await page.locator('.root-wrapper').boundingBox();
  for (const expected of [7, 10]) {
    await page.mouse.move(box.x + 350, box.y + 200); await page.mouse.down();
    await page.mouse.move(box.x + 374, box.y + 200, { steps: 3 }); await page.mouse.up();
    await until(page, () => __test.app.views.current() >= 0);
    assert.equal(await page.evaluate(() => __test.app.views.current()), expected);
  }
  assert.equal(await page.evaluate(() => mock.nativeIndex), 10);
  assert.equal(await page.locator('.root-wrapper').getAttribute('data-dcd360-preview-hidden'), null);
  // 回归：切换视角后下载按钮必须仍可点击。
  const saved = await download(page, 'current'); assert.equal(saved.name, '懂车帝车辆_011.webp');
});

test('油猴 window 不能作为 MouseEvent.view 时仍能驱动原生视口', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => {
    const NativeMouseEvent = window.MouseEvent;
    window.MouseEvent = class extends NativeMouseEvent {
      constructor(type, init) {
        if (init && 'view' in init) throw new TypeError("Failed to convert value to 'Window'.");
        super(type, init);
      }
    };
  });
  await menu(page, 'view'); await page.locator('[data-view="front"]').click();
  await until(page, () => !__test.app.views.switching);
  assert.equal(await page.evaluate(() => mock.nativeIndex), 4);
  assert.equal(await page.locator('[data-view="front"]').getAttribute('aria-pressed'), 'true');
});

test('面板 hover、跨间隙、点击固定、互斥、Esc 与外部点击', async (t) => {
  const page = await fixture(t);
  await trigger(page, 'view').hover(); await page.waitForTimeout(190); assert(await panel(page, 'view').isVisible());
  const buttonBox = await trigger(page, 'view').boundingBox(); const panelBox = await panel(page, 'view').boundingBox();
  await page.mouse.move(buttonBox.x + 10, buttonBox.y - 4); await page.waitForTimeout(90);
  await page.mouse.move(panelBox.x + 30, panelBox.y + 20); await page.waitForTimeout(280); assert(await panel(page, 'view').isVisible());
  await trigger(page, 'view').click(); await page.locator('#outside').hover(); await page.waitForTimeout(280); assert(await panel(page, 'view').isVisible());
  await trigger(page, 'download').click(); assert(await panel(page, 'download').isVisible()); assert(!(await panel(page, 'view').isVisible()));
  await trigger(page, 'download').click(); assert(!(await panel(page, 'download').isVisible()));
  await trigger(page, 'view').click(); await page.keyboard.press('Escape'); assert(!(await panel(page, 'view').isVisible()));
  await trigger(page, 'view').click(); await page.locator('#outside').click(); assert(!(await panel(page, 'view').isVisible()));
});

test('四种下载：字节、Alpha 输入、名称、顺序、ZIP STORE、最多 4 并发', async (t) => {
  const page = await fixture(t);
  let saved = await download(page, 'current'); assert.equal(saved.name, '懂车帝车辆_002.webp'); assert.deepEqual(Buffer.from(saved.bytes), Buffer.from(images[1], 'base64'));
  saved = await download(page, 'four'); await verifyZip(saved, [4, 13, 22, 31], ['正前方.webp', '正右侧.webp', '正后方.webp', '正左侧.webp']);
  saved = await download(page, 'eight'); await verifyZip(saved, [4, 8, 13, 18, 22, 26, 31, 0], ['正前方.webp', '前右45°.webp', '正右侧.webp', '后右45°.webp', '正后方.webp', '后左45°.webp', '正左侧.webp', '前左45°.webp']);
  saved = await download(page, 'all'); assert.equal(saved.name, '懂车帝车辆_360.zip'); await verifyZip(saved, Array.from({ length: 36 }, (_, i) => i));
  assert.equal(await page.evaluate(() => mock.maxActive), 4);
  await menu(page, 'view'); await page.locator('[data-view="front"]').click();
  await until(page, () => __test.app.views.current() >= 0);
  saved = await download(page, 'current'); assert.equal(saved.name, '懂车帝车辆_正前方.webp'); assert.deepEqual(Buffer.from(saved.bytes), Buffer.from(images[4], 'base64'));
  // 原生拖拽到某个预设帧时也能命名，不依赖是否点击过插件方向按钮。
  await page.evaluate(() => setNative(22));
  saved = await download(page, 'current'); assert.equal(saved.name, '懂车帝车辆_正后方.webp'); assert.deepEqual(Buffer.from(saved.bytes), Buffer.from(images[22], 'base64'));
});

test('失败重试最多两次，损坏/截断 WebP、HTTP 错误、超时均不导出', async (t) => {
  await t.test('失败两次后第三次成功', async (st) => {
    const page = await fixture(st); await page.evaluate(() => { mock.failures[1] = 2; }); await download(page, 'current');
    assert.equal(await page.evaluate(() => mock.requests.length), 3);
  });
  for (const kind of ['http', 'invalid', 'truncated', 'timeout']) await t.test(kind, async (st) => {
    const page = await fixture(st);
    await page.evaluate((kind) => {
      if (kind === 'http') mock.failures[0] = 9;
      if (kind === 'invalid') mock.invalid = [0];
      if (kind === 'truncated') mock.truncated = [0];
      if (kind === 'timeout') mock.timeouts = [0];
    }, kind);
    await menu(page, 'download'); await page.locator('[data-download="all"]').click();
    await until(page, () => !__test.app.downloads.task);
    assert.equal(await page.evaluate(() => mock.saved.length), 0);
    assert.equal(await page.evaluate(() => mock.requests.filter((request) => request.index === 0).length), 3);
    assert.match(await page.locator('.feedback').textContent(), /下载未完成/);
  });
});

test('重复点击、手动取消、颜色变化、残缺更新与任务快照', async (t) => {
  const page = await fixture(t); await page.evaluate(() => { mock.delay = 600; });
  await menu(page, 'download'); await page.locator('[data-download="all"]').click();
  assert(await page.locator('[data-download="all"]').isDisabled());
  await page.evaluate(() => __test.app.downloads.start('all'));
  assert.equal(await page.evaluate(() => mock.requests.length), 4);
  await page.locator('.cancel').click(); await until(page, () => !__test.app.downloads.task);
  assert.equal(await page.evaluate(() => mock.saved.length), 0); assert.equal(await page.evaluate(() => mock.active), 0);
  await page.locator('[data-download="all"]').click();
  await page.evaluate(() => document.querySelectorAll('.root-wrapper img').forEach((img) => { img.src = img.src.replace('blue-', 'red-'); }));
  await until(page, () => !__test.app.downloads.task); await available(page);
  assert.equal(await page.evaluate(() => mock.saved.length), 0);
  assert.match(await page.locator('.feedback').textContent(), /已变化.*取消/);
  await page.evaluate(() => { mock.delay = 10; mock.requests = []; });
  const saved = await download(page, 'all'); await verifyZip(saved, Array.from({ length: 36 }, (_, i) => i));
  assert((await page.evaluate(() => mock.requests)).every((request) => request.url.includes('red-')));
  await page.evaluate(() => { const root = document.querySelector('.root-wrapper'); window.lastFrame = root.lastElementChild; lastFrame.remove(); });
  await toolbar(page).waitFor({ state: 'detached' });
  await page.evaluate(() => document.querySelector('.root-wrapper').append(lastFrame)); await available(page);
});

test('动态页面：工具栏重绘、隐藏恢复、路由切换、全屏与面板边界', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => { const bar = document.querySelector('.toolbar'); bar.innerHTML = '<button class="native-fullscreen">全屏</button>'; });
  await available(page); assert.equal(await toolbar(page).count(), 1);
  await page.evaluate(() => { document.querySelector('#vehicle').hidden = true; }); await toolbar(page).waitFor({ state: 'detached' });
  await page.evaluate(() => { document.querySelector('#vehicle').hidden = false; }); await available(page);
  await page.evaluate((html) => { history.pushState({}, '', '/auto/series/99'); document.querySelector('#vehicle').outerHTML = html.replaceAll('blue-', 'green-'); mock.nativeIndex = 1; bindNative(document.querySelector('#vehicle .root-wrapper')); }, viewport());
  await available(page); await until(page, () => __test.app.manager.data?.route.endsWith('/99'));
  await page.locator('.native-fullscreen').evaluate((button) => button.addEventListener('click', () => button.closest('section').requestFullscreen()));
  await page.locator('.native-fullscreen').click(); await until(page, () => !!document.fullscreenElement);
  await available(page); await menu(page, 'view'); await page.locator('[data-view="right"]').click();
  assert(await page.evaluate(() => document.fullscreenElement.contains(document.querySelector('[data-dcd360-owned="panels"]'))));
  assert.equal(await page.locator('[data-dcd360-owned="preview"]').count(), 0);
  await until(page, () => __test.app.views.current() === 13);
  const box = await panel(page, 'view').boundingBox(); assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1000 && box.y + box.height <= 780);
  await page.evaluate(() => document.exitFullscreen()); await until(page, () => !document.fullscreenElement);
  await available(page); assert.equal(await toolbar(page).count(), 1);
  await page.setViewportSize({ width: 440, height: 500 }); await menu(page, 'download');
  const smaller = await panel(page, 'download').boundingBox(); assert(smaller.x >= 0 && smaller.y >= 0 && smaller.x + smaller.width <= 440 && smaller.y + smaller.height <= 500);
});

test('Blob 保存实际触发浏览器文件下载，不依赖扩展下载回调', async (t) => {
  const page = await fixture(t); await page.evaluate(() => { mock.saveMode = 'browser'; });
  await menu(page, 'download'); const waiting = page.waitForEvent('download'); await page.locator('[data-download="current"]').click();
  const file = await waiting; assert.equal(file.suggestedFilename(), '懂车帝车辆_002.webp');
  assert.deepEqual(fs.readFileSync(await file.path()), Buffer.from(images[1], 'base64'));
  await until(page, () => !__test.app.downloads.task);
});

test('没有外部 JSZip 仍可完成单张和完整 ZIP 下载', async (t) => {
  const page = await fixture(t, { noZip: true });
  assert.equal(await page.evaluate(() => typeof JSZip), 'undefined');
  await download(page, 'current'); await verifyZip(await download(page, 'all'), Array.from({ length: 36 }, (_, i) => i));
});

test('路由先变化、旧 DOM 暂留时不能重新启用旧序列；锚点变化不误伤', async (t) => {
  const page = await fixture(t); await page.evaluate(() => { location.hash = 'photos'; });
  await page.waitForTimeout(400); assert.equal(await toolbar(page).count(), 1);
  await page.evaluate(() => history.pushState({}, '', '/auto/series/777'));
  await toolbar(page).waitFor({ state: 'detached' }); await page.waitForTimeout(700);
  assert.equal(await toolbar(page).count(), 0); assert.equal(await page.evaluate(() => __test.app.manager.data), null);
  await page.evaluate(() => document.querySelectorAll('.root-wrapper img').forEach((img) => { img.src = img.src.replace('blue-', 'new-'); }));
  await available(page); assert((await page.evaluate(() => __test.app.manager.snapshot().urls)).every((url) => url.includes('new-')));
});

test('分批替换 URL 时等待稳定，避免立即使用新旧混合序列', async (t) => {
  const page = await fixture(t);
  await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll('.root-wrapper img')];
    imgs[0].src = imgs[0].src.replace('blue-', 'new-');
    await new Promise((resolve) => setTimeout(resolve, 40));
    if (document.querySelector('[data-dcd360-owned="toolbar"]')) throw new Error('第一帧变化后旧工具栏未立即撤销');
    for (const img of imgs.slice(1)) { img.src = img.src.replace('blue-', 'new-'); await new Promise((resolve) => setTimeout(resolve, 8)); }
  });
  await available(page); assert((await page.evaluate(() => __test.app.manager.snapshot().urls)).every((url) => url.includes('new-')));
});

test('原生切换期间不把中间帧当作目标帧下载', async (t) => {
  const page = await fixture(t);
  const state = await page.evaluate(async () => {
    __test.app.views.select('front'); const current = __test.app.views.current();
    await __test.app.downloads.start('current');
    return { current, requests: mock.requests.length, message: __test.app.ui.lastMessage };
  });
  assert.equal(state.current, -1); assert.equal(state.requests, 0); assert.match(state.message, /当前帧尚不明确/);
  await until(page, () => __test.app.views.current() === 4);
  await download(page, 'current');
});

test('安全 URL 与文件名处理不接受伪装域名及非法协议', async (t) => {
  const page = await fixture(t);
  const state = await page.evaluate(() => ({
    bad: ['https://dcarimg.com.evil.example/x.webp', 'https://evil-dcarimg.com/x.webp', 'data:image/webp;base64,AAAA', 'https://p3.dcarimg.com/x.jpg'].map(__test.imageURL),
    name: __test.safeName('A/B' + String.fromCharCode(92) + 'C:*?' + String.fromCharCode(1) + ' .'),
  }));
  assert.deepEqual(state.bad, [null, null, null, null]); assert.equal(state.name, 'A_B_C____');
});

test('首次渲染占位 URL 后只更新 src 也能恢复完整视口', async (t) => {
  const page = await fixture(t, { html: viewport().replaceAll('p3.dcarimg.com', 'placeholder.example'), available: false });
  await page.waitForTimeout(400); assert.equal(await toolbar(page).count(), 0);
  await page.evaluate(() => document.querySelectorAll('.root-wrapper img').forEach((img) => { img.src = img.src.replace('placeholder.example', 'p3.dcarimg.com'); }));
  await available(page); assert.equal(await page.evaluate(() => __test.app.manager.snapshot().urls.length), 36);
});

test('离开页面和页面缓存恢复的生命周期不重复注入', async (t) => {
  const page = await fixture(t);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    assert.equal(await toolbar(page).count(), 0); assert.equal(await page.evaluate(() => __test.app.started), false);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
    await available(page); assert.equal(await toolbar(page).count(), 1);
    assert.equal(await page.locator('[data-dcd360-owned="preview"]').count(), 0);
  }
});

test('原生不响应或一次跳多帧时明确失败，不自动进入插件预览', async (t) => {
  for (const nativeMode of ['none', 'double']) await t.test(nativeMode, async (st) => {
    const page = await fixture(st, { nativeMode });
    await page.evaluate(() => __test.app.views.select('front'));
    assert.match(await page.evaluate(() => __test.app.ui.lastMessage), /切换未完成/);
    assert.equal(await page.locator('[data-dcd360-owned="preview"]').count(), 0);
    assert.equal(await page.evaluate(() => mock.nativePressed), false);
    const saved = await download(page, 'current'); assert(saved.name.endsWith('.webp'));
  });
});

test('原生方向相反时按实际帧变化校准方向', async (t) => {
  const page = await fixture(t, { nativeMode: 'reverse' });
  await page.evaluate(() => __test.app.views.select('rear'));
  assert.equal(await page.evaluate(() => __test.app.views.current()), 22);
  assert.equal(await page.evaluate(() => mock.nativeIndex), 22);
});

test('快速连续选择采用最后一次，真实按键中断后不再抢回角度', async (t) => {
  const page = await fixture(t);
  await page.evaluate(async () => {
    __test.app.views.select('rear'); await __test.app.views.select('left');
  });
  assert.equal(await page.evaluate(() => __test.app.views.current()), 31);
  await page.evaluate(() => { __test.app.views.select('right'); });
  await page.keyboard.press('ArrowLeft'); await until(page, () => !__test.app.views.switching);
  const interrupted = await page.evaluate(() => mock.nativeIndex);
  await page.waitForTimeout(400); assert.equal(await page.evaluate(() => mock.nativeIndex), interrupted);
  assert.equal(await page.evaluate(() => mock.nativePressed), false);
  const saved = await download(page, 'current'); assert(saved.name.endsWith('.webp'));
});

test('真实鼠标接管后不发送迟到的 mouseup，不抢占用户正在进行的拖拽', async (t) => {
  const page = await fixture(t);
  await page.evaluate(() => { __test.app.views.select('rear'); });
  await until(page, () => mock.nativePressed);
  const box = await page.locator('.root-wrapper').boundingBox();
  await page.mouse.move(box.x + 350, box.y + 200); await page.mouse.down();
  await until(page, () => !__test.app.views.switching);
  assert.equal(await page.evaluate(() => mock.nativePressed), true);
  const start = await page.evaluate(() => mock.nativeIndex);
  await page.mouse.move(box.x + 374, box.y + 200, { steps: 3 }); await page.mouse.up();
  assert.equal(await page.evaluate(() => mock.nativeIndex), (start + 3) % 36);
  await page.waitForTimeout(300); assert.equal(await page.evaluate(() => mock.nativeIndex), (start + 3) % 36);
});

test('GM 完全不回调时由独立超时兜底，重试后解除忙碌状态', async (t) => {
  const page = await fixture(t); await page.clock.install();
  await page.evaluate(() => { mock.silent = [1]; __test.app.downloads.start('current'); });
  for (let i = 0; i < 8 && await page.evaluate(() => !!__test.app.downloads.task); i++) await page.clock.fastForward(26000);
  assert.equal(await page.evaluate(() => !!__test.app.downloads.task), false);
  assert.equal(await page.evaluate(() => mock.requests.length), 3);
  assert.equal(await page.evaluate(() => mock.active), 0);
  assert.match(await page.evaluate(() => __test.app.ui.lastMessage), /超时/);
  assert.equal(await page.evaluate(() => mock.saved.length), 0);
});
