// ==UserScript==
// @name         懂车帝 360° 车辆图片提取助手
// @namespace    https://github.com/dongchedi-360/userscript
// @version      1.1.5
// @homepageURL  https://github.com/Wutpeach/userscripts/tree/main/scripts/dongchedi-360
// @supportURL   https://github.com/Wutpeach/userscripts/issues
// @updateURL    https://raw.githubusercontent.com/Wutpeach/userscripts/main/scripts/dongchedi-360/dongchedi-360.user.js
// @downloadURL  https://raw.githubusercontent.com/Wutpeach/userscripts/main/scripts/dongchedi-360/dongchedi-360.user.js
// @description  在原生全屏按钮右侧添加原生视角切换和原始 WebP 下载，支持四/八方向及完整 36 帧 ZIP。
// @match        https://www.dongchedi.com/*
// @match        https://dongchedi.com/*
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @connect      dcarimg.com
// @connect      *.dcarimg.com
// @license      MIT
// ==/UserScript==

/* global GM_xmlhttpRequest */
(() => {
  'use strict';

  const FRAME_SELECTOR = '[class*="series-360-image_frame-wrapper"]';
  const FRAME_COUNT = 36;
  // 序号从 1 开始；角度映射集中管理，方便后续校准。
  const VIEW_PRESETS = Object.freeze({
    front: 5, frontRight: 9, right: 14, rearRight: 19,
    rear: 23, rearLeft: 27, left: 32, frontLeft: 1,
  });
  const VIEW_LABELS = Object.freeze({
    front: '正前方', frontRight: '前右45°', right: '正右侧', rearRight: '后右45°',
    rear: '正后方', rearLeft: '后左45°', left: '正左侧', frontLeft: '前左45°',
  });
  const STANDARD_VIEWS = ['front', 'right', 'rear', 'left'];
  const ALL_VIEWS = ['front', 'frontRight', 'right', 'rearRight', 'rear', 'rearLeft', 'left', 'frontLeft'];
  const OWN_SELECTOR = '[data-dcd360-owned]';
  // BEGIN LUCIDE 0.468.0 — official icons; sources: assets/lucide/
  /*
   * ISC License
   * 
   * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
   * 
   * Permission to use, copy, modify, and/or distribute this software for any
   * purpose with or without fee is hereby granted, provided that the above
   * copyright notice and this permission notice appear in all copies.
   * 
   * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
   * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
   * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
   * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
   * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
   * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
   * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
   */
  const ICONS = Object.freeze({
    "view": "<path d=\"m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z\" /> <circle cx=\"12\" cy=\"12\" r=\"10\" />",
    "download": "<path d=\"M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4\" /> <polyline points=\"7 10 12 15 17 10\" /> <line x1=\"12\" x2=\"12\" y1=\"15\" y2=\"3\" />",
    "car": "<path d=\"m21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8\" /> <path d=\"M7 14h.01\" /> <path d=\"M17 14h.01\" /> <rect width=\"18\" height=\"8\" x=\"3\" y=\"10\" rx=\"2\" /> <path d=\"M5 18v2\" /> <path d=\"M19 18v2\" />",
    "chevron": "<path d=\"m6 9 6 6 6-6\" />"
});
  // END LUCIDE
  const icon = (name) => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  const errorText = (error) => error instanceof Error ? error.message : String(error);
  const abortError = () => new Error('任务已取消');
  const safeName = (value) => [...String(value || '懂车帝车辆')].map((char) =>
    char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char.charCodeAt(0) === 92 || '<>:"/|?*'.includes(char) ? '_' : char
  ).join('').replace(/[. ]+$/g, '').trim().slice(0, 90) || '懂车帝车辆';
  const frameName = (index) => String(index + 1).padStart(3, '0') + '.webp';
  const viewFrameName = (index) => {
    const key = ALL_VIEWS.find((key) => VIEW_PRESETS[key] - 1 === index);
    return key ? VIEW_LABELS[key] + '.webp' : frameName(index);
  };
  const routeKey = () => location.origin + location.pathname + location.search;

  function imageURL(value) {
    try {
      const url = new URL(value, location.href);
      if (!/(^|\.)dcarimg\.com$/i.test(url.hostname) || !/\.webp$/i.test(url.pathname) || url.username || url.password) return null;
      if (!['http:', 'https:'].includes(url.protocol)) return null;
      url.protocol = 'https:'; url.hash = '';
      return url.href;
    } catch { return null; }
  }

  function visible(element) {
    if (!element?.isConnected || !element.getClientRects().length) return false;
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
    }
    return true;
  }

  class SiteAdapter {
    isFrame(node) {
      return node instanceof Element && [...node.classList].some((name) => name.startsWith('series-360-image_frame-wrapper'));
    }

    readFrames(root) {
      // 只接受同一父容器的 36 个帧节点，不向上拼接多个残缺序列。
      const wrappers = [...root.children].filter((node) => this.isFrame(node));
      if (wrappers.length !== FRAME_COUNT) return null;
      const frames = wrappers.map((wrapper) => {
        const images = wrapper.querySelectorAll('img');
        if (images.length !== 1) return null;
        const img = images[0];
        const url = imageURL(img.getAttribute('src') || '');
        return url ? { wrapper, img, url } : null;
      });
      return frames.every(Boolean) && new Set(frames.map((frame) => frame.url)).size === FRAME_COUNT ? frames : null;
    }

    findToolbar(root) {
      let scope = root.parentElement;
      for (let depth = 0; scope && scope !== document.body && depth < 7; depth++, scope = scope.parentElement) {
        const groups = new Set([...scope.querySelectorAll(FRAME_SELECTOR)].filter((node) => this.isFrame(node)).map((node) => node.parentElement));
        if (groups.size > 1) break;
        const nodes = [...scope.querySelectorAll('button,[role="button"],a,[title],[aria-label],span,div')];
        // 优先原生可点击元素，避免把只含「全屏」文本的整条工具栏当作按钮。
        nodes.sort((a, b) => Number(b.matches('button,[role="button"],a')) - Number(a.matches('button,[role="button"],a')) || Number(a.children.length > 0) - Number(b.children.length > 0));
        for (const node of nodes) {
          if (node.closest(OWN_SELECTOR) || root.contains(node) || !visible(node)) continue;
          const label = (node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent).trim();
          if (!/^(退出)?全屏$/.test(label)) continue;
          let anchor = node.closest('button,[role="button"],a') || node;
          if (!scope.contains(anchor)) continue;
          // 原站可能使用 div 包裹图标与文本，把完整工具项目作为插入锚点。
          for (let i = 0; i < 3 && anchor.parentElement !== scope; i++) {
            const parent = anchor.parentElement;
            if (!parent || parent === root || /flex|grid/.test(getComputedStyle(parent).display) || parent.textContent.trim() !== label) break;
            anchor = parent;
          }
          return { anchor, scope };
        }
      }
      return null;
    }

    detect() {
      const parents = new Set([...document.querySelectorAll(FRAME_SELECTOR)].filter((node) => this.isFrame(node) && !node.closest(OWN_SELECTOR)).map((node) => node.parentElement));
      const candidates = [];
      for (const root of parents) {
        const rect = root.getBoundingClientRect();
        if (rect.width < 120 || rect.height < 80 || !visible(root)) continue;
        if (document.fullscreenElement && !document.fullscreenElement.contains(root)) continue;
        const frames = this.readFrames(root);
        const toolbar = frames && this.findToolbar(root);
        if (!frames || !toolbar) continue;
        const displayed = frames.filter(({ wrapper }) => Number(getComputedStyle(wrapper).opacity) > 0.95 && getComputedStyle(wrapper).display !== 'none');
        if (displayed.length !== 1) continue;
        candidates.push({ root, frames, ...toolbar });
      }
      return candidates.length === 1 ? candidates[0] : null;
    }

    filename() {
      // 保守使用通用名称；DOM 尚没有已实测的车型/颜色字段，避免误用旧的 JSON-LD。
      return '懂车帝车辆';
    }
  }

  class FrameManager {
    constructor(adapter) { this.adapter = adapter; this.data = null; this.revision = 0; }
    update(candidate) {
      const signature = candidate ? JSON.stringify(candidate.frames.map((frame) => frame.url)) : '';
      const changed = this.data?.root !== candidate?.root || (this.data?.signature || '') !== signature || (this.data && this.data.route !== routeKey());
      if (changed) this.revision++;
      this.data = candidate ? { ...candidate, signature, route: routeKey() } : null;
      return changed;
    }
    current() {
      if (!this.data) return -1;
      const indices = this.data.frames.flatMap(({ wrapper }, index) => {
        const style = getComputedStyle(wrapper);
        return Number(style.opacity) > 0.95 && style.display !== 'none' ? [index] : [];
      });
      return indices.length === 1 ? indices[0] : -1;
    }
    valid() {
      if (!this.data || !visible(this.data.root) || this.data.route !== routeKey()) return false;
      if (document.fullscreenElement && !document.fullscreenElement.contains(this.data.root)) return false;
      const frames = this.adapter.readFrames(this.data.root);
      return !!frames && JSON.stringify(frames.map((frame) => frame.url)) === this.data.signature;
    }
    snapshot() {
      if (!this.valid()) throw new Error('当前 360° 图片正在变化或不足 36 张，请等待加载完成');
      return Object.freeze({
        urls: Object.freeze(this.data.frames.map((frame) => frame.url)),
        revision: this.revision, route: routeKey(), name: safeName(this.adapter.filename()),
      });
    }
  }

  class NativeDragController {
    constructor(manager) { this.manager = manager; this.operation = null; this.unavailable = new WeakMap(); }
    cancel() { this.operation?.abort(); this.release?.(); }
    async goTo(target) {
      const data = this.manager.data;
      if (!data || !this.manager.valid()) return { cancelled: true };
      if (this.unavailable.get(data.root) === data.signature) return { ok: false };
      if (this.manager.current() === target) return { ok: true };
      const controller = new AbortController(); this.operation = controller;
      const { signal } = controller; const root = data.root;
      const interrupted = (event) => {
        if (!event.isTrusted) return;
        if (event.type === 'pointermove' && !root.contains(event.target) && !event.buttons) return;
        this.cancel();
      };
      document.addEventListener('pointerdown', interrupted, true);
      document.addEventListener('pointermove', interrupted, true);
      document.addEventListener('keydown', interrupted, true);
      const check = () => {
        if (signal.aborted || this.manager.data?.root !== root || !this.manager.valid()) throw abortError();
      };
      const tick = () => new Promise((resolve) => {
        // 后台标签页的 rAF 可能被节流；计时器只用于单次交互期间的有界等待。
        let frame; const timer = setTimeout(() => { cancelAnimationFrame(frame); resolve(); }, 50);
        frame = requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
      });
      const settle = async () => { await tick(); await tick(); check(); };
      const changedFrame = async (previous) => {
        const deadline = performance.now() + 240;
        do { await tick(); check(); const current = this.manager.current(); if (current >= 0 && current !== previous) return current; } while (performance.now() < deadline);
        return previous;
      };
      const rect = root.getBoundingClientRect(); let x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2; let pressed = false;
      const dispatch = (type, buttons) => root.dispatchEvent(new MouseEvent(type, {
        // 真站油猴环境已复现：沙盒 window 传给 view 会抛 Failed to convert value to Window。
        // 不需要 view 即可驱动原生事件，避免把代理对象传入原生构造器。
        bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons,
      }));
      const release = () => {
        if (!pressed) return;
        pressed = false;
        if (root.isConnected) dispatch('mouseup', 0);
      };
      this.release = release;
      try {
        check();
        dispatch('mouseover', 0); await settle();
        dispatch('mousedown', 1); pressed = true; await settle();
        let previous = this.manager.current();
        if (previous < 0) return { ok: false };
        // 不预设拖拽方向一定相同，先用一次小位移验证原生状态确实推进一帧。
        x += 8; dispatch('mousemove', 1);
        let current = await changedFrame(previous);
        const positiveDelta = (current - previous + FRAME_COUNT) % FRAME_COUNT;
        if (![1, FRAME_COUNT - 1].includes(positiveDelta)) {
          this.unavailable.set(root, data.signature); return { ok: false };
        }
        const orientation = positiveDelta === 1 ? 1 : -1;
        for (let step = 0; current !== target && step < FRAME_COUNT; step++) {
          const distance = (target - current + FRAME_COUNT) % FRAME_COUNT;
          const direction = distance <= FRAME_COUNT / 2 ? 1 : -1;
          previous = current; x += direction * orientation * 8; dispatch('mousemove', 1);
          current = await changedFrame(previous);
          if ((current - previous + FRAME_COUNT) % FRAME_COUNT !== (direction + FRAME_COUNT) % FRAME_COUNT) {
            this.unavailable.set(root, data.signature); return { ok: false };
          }
        }
        dispatch('mouseup', 0); pressed = false; await settle();
        const ok = this.manager.current() === target;
        if (!ok) this.unavailable.set(root, data.signature);
        return { ok };
      } catch (error) {
        if (signal.aborted || !this.manager.valid()) return { cancelled: true };
        this.unavailable.set(root, data.signature); return { ok: false, reason: errorText(error) };
      } finally {
        release();
        document.removeEventListener('pointerdown', interrupted, true); document.removeEventListener('pointermove', interrupted, true); document.removeEventListener('keydown', interrupted, true);
        if (this.operation === controller) { this.operation = null; this.release = null; }
      }
    }
  }

  class ViewController {
    constructor(manager, notify, onChange) {
      this.manager = manager; this.notify = notify; this.onChange = onChange;
      this.native = new NativeDragController(manager);
      this.selectionToken = 0; this.selectionPromise = Promise.resolve(); this.switching = false;
    }
    current() { return this.switching ? -1 : this.manager.current(); }
    select(key) {
      if (!this.manager.valid()) { this.notify('图片正在更新，请稍后重试', true); return; }
      const target = VIEW_PRESETS[key] - 1;
      const token = ++this.selectionToken;
      this.native.cancel(); this.switching = true; this.onChange();
      this.selectionPromise = this.selectionPromise.catch(() => {}).then(async () => {
        if (token !== this.selectionToken) return;
        try {
          const result = await this.native.goTo(target);
          if (token !== this.selectionToken || !this.manager.valid()) return;
          if (result.cancelled) this.notify('已停止视角切换，可继续拖拽原生视口');
          else if (!result.ok) this.notify('网页未响应兼容的原生拖拽，视角切换未完成，请直接拖拽原生视口' + (result.reason ? '；' + result.reason : ''), true);
        } catch (error) {
          if (token === this.selectionToken) this.notify('视角切换未完成：' + errorText(error), true);
        } finally {
          if (token === this.selectionToken) { this.switching = false; this.onChange(); }
        }
      });
      return this.selectionPromise;
    }
    close() {
      this.selectionToken++; this.native.cancel(); this.switching = false; this.onChange();
    }
  }
  function pause(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) { reject(abortError()); return; }
      const abort = () => { clearTimeout(timer); reject(abortError()); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms);
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  // 只写 ZIP STORE，不转码图片。避免第三方异步调度器在油猴代理 Window 中挂起。
  class StoreZip {
    static crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
      let crc = value;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
      return crc >>> 0;
    });
    static async pack(indices, results, signal, progress, nameForFrame = frameName) {
      const local = []; const directory = []; let offset = 0; let directorySize = 0;
      for (let slot = 0; slot < indices.length; slot++) {
        if (signal.aborted) throw abortError();
        const bytes = new Uint8Array(results[slot]);
        const filename = new TextEncoder().encode(nameForFrame(indices[slot]));
        if (bytes.length > 0xffffffff || offset + 30 + filename.length + bytes.length > 0xffffffff) throw new Error('图片总量超过 ZIP32 支持范围');
        let crc = 0xffffffff;
        for (let i = 0; i < bytes.length; i++) {
          crc = (crc >>> 8) ^ this.crcTable[(crc ^ bytes[i]) & 0xff];
          // 大图 CRC 运算分片，让取消和页面切换有机会响应。
          if (i > 0 && i % 1048576 === 0) await pause(0, signal);
        }
        crc = (crc ^ 0xffffffff) >>> 0;
        const header = new Uint8Array(30 + filename.length); const view = new DataView(header.buffer);
        view.setUint32(0, 0x04034b50, true); view.setUint16(4, 20, true);
        view.setUint16(6, 0x0800, true); // ZIP UTF-8 标记，确保中文和 ° 在解压软件中正确显示。
        view.setUint16(12, 0x21, true); // DOS 日期 1980-01-01；图片无可靠原始时间。
        view.setUint32(14, crc, true); view.setUint32(18, bytes.length, true); view.setUint32(22, bytes.length, true);
        view.setUint16(26, filename.length, true); header.set(filename, 30);
        local.push(header, bytes);
        const entry = new Uint8Array(46 + filename.length); const central = new DataView(entry.buffer);
        central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true);
        central.setUint16(8, 0x0800, true);
        central.setUint16(14, 0x21, true); central.setUint32(16, crc, true);
        central.setUint32(20, bytes.length, true); central.setUint32(24, bytes.length, true);
        central.setUint16(28, filename.length, true); central.setUint32(42, offset, true); entry.set(filename, 46);
        directory.push(entry); directorySize += entry.length; offset += header.length + bytes.length;
        progress(Math.round((slot + 1) / indices.length * 100)); await pause(0, signal);
      }
      if (offset + directorySize + 22 > 0xffffffff) throw new Error('图片总量超过 ZIP32 支持范围');
      const end = new Uint8Array(22); const view = new DataView(end.buffer);
      view.setUint32(0, 0x06054b50, true); view.setUint16(8, indices.length, true); view.setUint16(10, indices.length, true);
      view.setUint32(12, directorySize, true); view.setUint32(16, offset, true);
      return new Blob([...local, ...directory, end], { type: 'application/zip' });
    }
  }

  class DownloadManager {
    constructor(manager, views, notify, progress) {
      this.manager = manager; this.views = views; this.notify = notify; this.progress = progress; this.task = null;
    }
    cancel(reason = '已取消下载') {
      if (!this.task) return;
      this.task.reason = reason; this.task.controller.abort();
    }
    async request(url, signal) {
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        if (signal.aborted) throw abortError();
        try {
          const bytes = await this.fetchBytes(url, signal); const header = new Uint8Array(bytes);
          const magic = (offset, text) => [...text].every((char, i) => header[offset + i] === char.charCodeAt(0));
          if (header.length < 12 || !magic(0, 'RIFF') || !magic(8, 'WEBP') || new DataView(bytes).getUint32(4, true) + 8 !== header.length) throw new Error('CDN 未返回完整的 WebP 原始数据');
          return bytes;
        } catch (error) {
          if (signal.aborted) throw abortError();
          lastError = error;
          if (attempt < 2) await pause(400 * (attempt + 1), signal);
        }
      }
      throw lastError;
    }
    fetchBytes(url, signal) {
      return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(abortError()); return; }
        let request; let done = false; let watchdog;
        const finish = (error, bytes) => {
          if (done) return;
          done = true; clearTimeout(watchdog); signal.removeEventListener('abort', abort);
          if (error) reject(error); else resolve(bytes);
        };
        const abort = () => { finish(abortError()); request?.abort(); };
        signal.addEventListener('abort', abort, { once: true });
        // 扩展重载或消息通道异常时，GM 自带的 timeout 可能没有回调。
        watchdog = setTimeout(() => {
          finish(new Error('图片请求超时（25 秒），请检查扩展是否启用及 CDN 访问权限'));
          request?.abort();
        }, 25000);
        try {
          request = GM_xmlhttpRequest({
            method: 'GET', url, responseType: 'arraybuffer', timeout: 25000, anonymous: true,
            onload: (response) => {
              if (response.status !== 200) { finish(new Error('图片请求失败：HTTP ' + response.status)); return; }
              if (response.finalUrl && !imageURL(response.finalUrl)) { finish(new Error('图片重定向到了非受支持的 CDN 地址')); return; }
              if (Object.prototype.toString.call(response.response) !== '[object ArrayBuffer]') { finish(new Error('图片响应不是二进制数据')); return; }
              finish(null, response.response);
            },
            onerror: () => finish(new Error('图片请求失败，请检查网络和 Tampermonkey CDN 跨域授权')),
            ontimeout: () => finish(new Error('图片请求超时（25 秒）')), onabort: () => finish(abortError()),
          });
        } catch (error) { finish(new Error('无法请求图片：' + errorText(error))); }
      });
    }
    async start(kind) {
      if (this.task) { this.notify('已有下载任务正在进行'); return; }
      let snapshot; let indices;
      try {
        snapshot = this.manager.snapshot(); const current = this.views.current();
        if (kind === 'current' && current < 0) throw new Error('当前帧尚不明确，请停止旋转后重试');
        indices = kind === 'current' ? [current] : kind === 'four' ? STANDARD_VIEWS.map((key) => VIEW_PRESETS[key] - 1) : kind === 'eight' ? ALL_VIEWS.map((key) => VIEW_PRESETS[key] - 1) : Array.from({ length: FRAME_COUNT }, (_, i) => i);
      } catch (error) { this.notify(errorText(error), true); return; }
      const task = { controller: new AbortController(), snapshot, reason: '' }; this.task = task;
      const { signal } = task.controller; this.progress(true, '正在下载 0 / ' + indices.length);
      let firstError;
      try {
        const results = new Array(indices.length); let cursor = 0; let completed = 0;
        const worker = async () => {
          try {
            while (cursor < indices.length && !signal.aborted) {
              const slot = cursor++;
              results[slot] = await this.request(snapshot.urls[indices[slot]], signal);
              if (signal.aborted) throw abortError();
              this.progress(true, '正在下载 ' + (++completed) + ' / ' + indices.length);
            }
          } catch (error) {
            if (!signal.aborted) { firstError = error; task.controller.abort(); }
            throw error;
          }
        };
        await Promise.allSettled(Array.from({ length: Math.min(4, indices.length) }, worker));
        if (firstError) throw firstError;
        if (signal.aborted) throw abortError();
        if (results.filter(Boolean).length !== indices.length) throw new Error('图片数据不完整，已停止导出');
        let blob; let filename;
        if (kind === 'current') {
          blob = new Blob([results[0]], { type: 'image/webp' }); filename = snapshot.name + '_' + viewFrameName(indices[0]);
        } else {
          // 请求完成后按指定顺序写入，避免并发完成顺序影响 ZIP 目录。
          blob = await StoreZip.pack(indices, results, signal, (percent) => this.progress(true, '正在打包 ' + percent + '%'), kind === 'all' ? frameName : viewFrameName);
          filename = snapshot.name + '_' + (kind === 'all' ? '360' : kind === 'four' ? '四个标准视角' : '八个预设视角') + '.zip';
        }
        if (signal.aborted) throw abortError();
        if (!this.manager.valid() || this.manager.revision !== snapshot.revision) throw new Error('车型、颜色或页面已变化，已停止导出');
        await this.save(blob, filename, signal);
      } catch (error) {
        this.notify(task.reason || '下载未完成：' + errorText(error), !task.reason);
      } finally {
        if (this.task === task) this.task = null;
        this.progress(false);
      }
    }
    async save(blob, name, signal) {
      if (signal.aborted) throw abortError();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = name; link.style.display = 'none';
      try {
        // 文件已在本地生成，直接交给浏览器保存；不依赖 GM_download 的扩展回调。
        (document.fullscreenElement || document.body).append(link); link.click();
      } finally {
        link.remove();
        // click 仅代表提交下载，浏览器仍可能显示保存提示或阻止自动下载。
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    }
  }

  const UI_CSS = [
    ':host{font-family:inherit;color:#30343b;box-sizing:border-box}*{box-sizing:border-box}',
    'button{font:inherit;cursor:pointer}button:focus-visible{outline:2px solid #3075d7;outline-offset:2px}button:disabled{cursor:wait;opacity:.5}',
    '.buttons{display:flex;align-items:center;gap:14px;height:100%;white-space:nowrap}',
    '.trigger{display:inline-flex;align-items:center;justify-content:center;gap:5px;padding:3px 0;border:0;background:none;color:var(--native-color,#555);font-size:var(--native-size,14px);line-height:1.5;border-radius:4px}',
    'svg{width:17px;height:17px;flex:none}.chevron{font-size:10px;margin-left:1px;opacity:.65}.trigger[aria-expanded=true]{color:#2869bd}',
    '.panel{position:fixed;pointer-events:auto;visibility:hidden;width:264px;padding:10px;background:#fff;color:#30343b;border:1px solid #e7e9ed;border-radius:9px;box-shadow:0 6px 26px #16223b24;font:13px/1.5 system-ui,-apple-system,"Microsoft YaHei",sans-serif;max-height:calc(100vh - 16px);overflow:auto}',
    '.chevron svg{width:12px;height:12px}.panel[hidden]{display:none}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}.view{border:0;border-radius:5px;background:#f6f7f9;color:#454b55;padding:10px 1px;font-size:12px}.view:hover,.view[aria-pressed=true]{color:#2365b5;background:#eaf2fc}',
    '.car{display:flex;align-items:center;justify-content:center;color:#9198a1}.car svg{width:29px;height:29px}',
    '.option{display:flex;flex-direction:column;align-items:flex-start;width:100%;border:0;border-radius:5px;background:none;color:inherit;text-align:left;padding:8px}.option:hover{background:#f3f6fa}.option small{color:#89919d;font-size:11px;margin-top:2px}',
    '.feedback{font-size:12px;color:#536071;padding:8px 3px 2px;overflow-wrap:anywhere}.feedback[data-error=true]{color:#bc3535}.progress{border-top:1px solid #edf0f3;margin-top:6px;padding-top:8px;font-size:12px}.cancel{border:0;background:none;color:#2365b5;float:right;font-size:12px;padding:0 2px}',
    '.toast{position:fixed;pointer-events:none;max-width:min(380px,calc(100vw - 16px));padding:9px 13px;background:#fff;border:1px solid #e1e5eb;border-radius:7px;box-shadow:0 4px 18px #0002;color:#30343b;font:12px/1.6 system-ui,"Microsoft YaHei",sans-serif;overflow-wrap:anywhere}.toast[data-error=true]{color:#bc3535}.toast[hidden]{display:none}',
  ].join('');

  class ToolbarUI {
    constructor(manager, views, onDownload, onCancel) {
      this.manager = manager; this.views = views; this.onDownload = onDownload; this.onCancel = onCancel;
      this.host = null; this.openPanel = null; this.pinned = false; this.busy = false;
      this.lastMessage = ''; this.lastError = false; this.progressMessage = '';
      this.hoverTimer = null; this.closeTimer = null;
      this.reposition = () => this.position();
      this.outside = (event) => {
        if (this.host && !event.composedPath().includes(this.host) && !event.composedPath().includes(this.portal)) this.close();
      };
      this.escape = (event) => { if (event.key === 'Escape') this.close(); };
      this.resizeObserver = new ResizeObserver(this.reposition);
    }
    mount(candidate) {
      if (this.host?.isConnected && this.anchor === candidate.anchor && this.host.previousElementSibling === candidate.anchor) {
        this.position(); return;
      }
      this.unmount(); this.anchor = candidate.anchor;
      const native = getComputedStyle(this.anchor);
      this.host = document.createElement('span'); this.host.dataset.dcd360Owned = 'toolbar';
      this.host.style.cssText = 'display:inline-flex;align-items:center;align-self:center;flex-shrink:0;margin-left:14px;vertical-align:middle;';
      this.host.style.setProperty('--native-color', native.color); this.host.style.setProperty('--native-size', native.fontSize);
      this.shadow = this.host.attachShadow({ mode: 'open' });
      this.shadow.innerHTML = '<style>' + UI_CSS + '</style><div class="buttons"><button type="button" class="trigger" data-panel="view" aria-haspopup="dialog" aria-expanded="false">' + icon('view') + '<span>视角</span><span class="chevron">' + icon('chevron') + '</span></button><button type="button" class="trigger" data-panel="download" aria-haspopup="dialog" aria-expanded="false">' + icon('download') + '<span>下载</span><span class="chevron">' + icon('chevron') + '</span></button></div>';
      this.anchor.after(this.host);
      this.portal = document.createElement('div'); this.portal.dataset.dcd360Owned = 'panels';
      this.portal.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483100;pointer-events:none;';
      this.panelShadow = this.portal.attachShadow({ mode: 'open' });
      this.panelShadow.innerHTML = '<style>' + UI_CSS + '</style><section class="panel" data-panel="view" role="dialog" aria-label="视角预设" hidden><div class="grid"></div></section><section class="panel" data-panel="download" role="dialog" aria-label="图片下载" hidden><div class="options"></div><div class="progress" hidden><span></span><button type="button" class="cancel">取消</button></div><div class="feedback" role="status" aria-live="polite" hidden></div></section><div class="toast" role="status" aria-live="polite" hidden></div>';
      (document.fullscreenElement || document.body).append(this.portal);
      const grid = this.panelShadow.querySelector('.grid');
      ['frontLeft', 'front', 'frontRight', 'left', null, 'right', 'rearLeft', 'rear', 'rearRight'].forEach((key) => {
        if (!key) {
          const center = document.createElement('div'); center.className = 'car'; center.innerHTML = icon('car'); center.setAttribute('aria-hidden', 'true'); grid.append(center); return;
        }
        const button = document.createElement('button'); button.type = 'button'; button.className = 'view';
        button.dataset.view = key; button.textContent = VIEW_LABELS[key];
        button.addEventListener('click', () => this.views.select(key)); grid.append(button);
      });
      const options = this.panelShadow.querySelector('.options');
      [
        ['current', '下载当前视角', '当前显示的原始 WebP'],
        ['four', '下载四个标准视角', '正前、正右、正后、正左 · ZIP'],
        ['eight', '下载八个预设视角', '八个方向的原始帧 · ZIP'],
        ['all', '下载完整 360° 序列', '36 张原始 WebP · ZIP'],
      ].forEach(([kind, label, detail]) => {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'option'; button.dataset.download = kind;
        const title = document.createElement('span'); title.textContent = label;
        const subtitle = document.createElement('small'); subtitle.textContent = detail;
        button.append(title, subtitle); button.addEventListener('click', () => { this.pinned = true; this.onDownload(kind); }); options.append(button);
      });
      this.panelShadow.querySelector('.cancel').addEventListener('click', () => this.onCancel());
      for (const button of this.shadow.querySelectorAll('.trigger')) {
        button.addEventListener('pointerenter', () => {
          clearTimeout(this.closeTimer); clearTimeout(this.hoverTimer);
          if (!this.pinned) this.hoverTimer = setTimeout(() => this.open(button.dataset.panel, false), 150);
        });
        button.addEventListener('pointerleave', () => this.deferClose());
        button.addEventListener('click', (event) => {
          event.stopPropagation(); clearTimeout(this.hoverTimer); clearTimeout(this.closeTimer);
          const key = button.dataset.panel;
          if (this.openPanel === key && this.pinned) this.close(); else this.open(key, true);
        });
        button.addEventListener('keydown', (event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); this.open(button.dataset.panel, true); this.panel(button.dataset.panel).querySelector('button')?.focus(); }
        });
      }
      for (const panel of this.panelShadow.querySelectorAll('.panel')) {
        panel.addEventListener('pointerenter', () => { clearTimeout(this.closeTimer); clearTimeout(this.hoverTimer); });
        panel.addEventListener('pointerleave', () => this.deferClose());
      }
      document.addEventListener('pointerdown', this.outside, true); document.addEventListener('keydown', this.escape);
      window.addEventListener('resize', this.reposition); window.addEventListener('scroll', this.reposition, true);
      this.resizeObserver.observe(this.anchor);
      this.update(); this.setProgress(this.busy, this.progressMessage);
      if (this.lastMessage) this.showMessage(this.lastMessage, this.lastError);
    }
    panel(key) { return this.panelShadow?.querySelector('.panel[data-panel="' + key + '"]'); }
    open(key, pinned) {
      if (!this.host?.isConnected) return;
      clearTimeout(this.hoverTimer); clearTimeout(this.closeTimer);
      this.openPanel = key; this.pinned = pinned;
      for (const panel of this.panelShadow.querySelectorAll('.panel')) panel.hidden = panel.dataset.panel !== key;
      for (const button of this.shadow.querySelectorAll('.trigger')) button.setAttribute('aria-expanded', String(button.dataset.panel === key));
      this.position();
    }
    close() {
      clearTimeout(this.hoverTimer); clearTimeout(this.closeTimer); this.openPanel = null; this.pinned = false;
      this.panelShadow?.querySelectorAll('.panel').forEach((panel) => { panel.hidden = true; });
      this.shadow?.querySelectorAll('.trigger').forEach((button) => button.setAttribute('aria-expanded', 'false'));
    }
    deferClose() {
      clearTimeout(this.hoverTimer); clearTimeout(this.closeTimer);
      if (!this.pinned) this.closeTimer = setTimeout(() => this.close(), 230);
    }
    position() {
      if (!this.portal || !this.host?.isConnected) return;
      const parent = document.fullscreenElement || document.body;
      if (parent !== this.portal.parentElement) parent.append(this.portal);
      const viewportWidth = document.documentElement.clientWidth; const viewportHeight = window.innerHeight;
      if (this.openPanel) {
        const panel = this.panel(this.openPanel);
        const button = this.shadow.querySelector('[data-panel="' + this.openPanel + '"]');
        const anchor = button.getBoundingClientRect(); panel.style.width = Math.min(264, viewportWidth - 16) + 'px';
        const rect = panel.getBoundingClientRect();
        const left = Math.max(8, Math.min(anchor.right - rect.width, viewportWidth - rect.width - 8));
        let top = anchor.top - rect.height - 8;
        if (top < 8) top = anchor.bottom + 8;
        top = Math.max(8, Math.min(top, viewportHeight - rect.height - 8));
        Object.assign(panel.style, { left: left + 'px', top: top + 'px', visibility: 'visible' });
      }
      const toast = this.panelShadow.querySelector('.toast');
      if (!toast.hidden) {
        const rect = this.host.getBoundingClientRect(); const box = toast.getBoundingClientRect();
        toast.style.left = Math.max(8, Math.min(rect.right - box.width, viewportWidth - box.width - 8)) + 'px';
        toast.style.top = Math.max(8, Math.min(rect.top - box.height - 12, viewportHeight - box.height - 8)) + 'px';
      }
    }
    update() {
      if (!this.panelShadow) return;
      const index = this.views.current();
      this.panelShadow.querySelectorAll('[data-view]').forEach((button) => button.setAttribute('aria-pressed', String(VIEW_PRESETS[button.dataset.view] - 1 === index)));
      const subtitle = this.panelShadow.querySelector('[data-download="current"] small');
      if (subtitle) subtitle.textContent = this.views.switching ? '正在切换视角，请等待完成' : '原生视口当前显示的原始 WebP';
      const currentButton = this.panelShadow.querySelector('[data-download="current"]');
      if (currentButton) currentButton.disabled = this.busy || this.views.switching;
    }
    showMessage(text, isError = false, toast = true) {
      this.lastMessage = text; this.lastError = isError;
      this.transient?.remove(); clearTimeout(this.transientTimer);
      if (!this.panelShadow) {
        // 视口消失时仍展示一次取消/错误反馈，不保留工具面板。
        this.transient = document.createElement('div'); this.transient.dataset.dcd360Owned = 'notice';
        this.transient.setAttribute('role', 'status'); this.transient.setAttribute('aria-live', 'polite');
        this.transient.textContent = text;
        this.transient.style.cssText = 'position:fixed;z-index:2147483200;left:50%;bottom:24px;transform:translateX(-50%);max-width:calc(100vw - 32px);padding:10px 14px;border:1px solid #e1e5eb;border-radius:7px;background:white;color:' + (isError ? '#bc3535' : '#30343b') + ';box-shadow:0 4px 18px #0002;font:12px/1.6 system-ui,sans-serif;pointer-events:none;';
        (document.fullscreenElement || document.body).append(this.transient);
        this.transientTimer = setTimeout(() => this.transient?.remove(), 7000);
        return;
      }
      const feedback = this.panelShadow.querySelector('.feedback');
      feedback.textContent = text; feedback.dataset.error = String(isError); feedback.hidden = false;
      if (toast && this.openPanel !== 'download') {
        const element = this.panelShadow.querySelector('.toast');
        element.textContent = text; element.dataset.error = String(isError); element.hidden = false;
        clearTimeout(this.toastTimer); this.toastTimer = setTimeout(() => { element.hidden = true; }, 7000);
      }
      this.position();
    }
    setProgress(busy, message = '') {
      const starting = busy && !this.busy;
      this.busy = busy; this.progressMessage = message;
      if (!this.panelShadow) return;
      if (starting) {
        this.lastMessage = ''; this.panelShadow.querySelector('.feedback').hidden = true;
        this.panelShadow.querySelector('.toast').hidden = true;
      }
      this.panelShadow.querySelectorAll('[data-download]').forEach((button) => { button.disabled = busy || (button.dataset.download === 'current' && this.views.switching); });
      const progress = this.panelShadow.querySelector('.progress'); progress.hidden = !busy; progress.querySelector('span').textContent = message;
      this.position();
    }
    unmount() {
      this.close(); clearTimeout(this.toastTimer); this.resizeObserver.disconnect();
      document.removeEventListener('pointerdown', this.outside, true); document.removeEventListener('keydown', this.escape);
      window.removeEventListener('resize', this.reposition); window.removeEventListener('scroll', this.reposition, true);
      this.host?.remove(); this.portal?.remove();
      this.host = null; this.portal = null; this.shadow = null; this.panelShadow = null;
    }
  }

  class Application {
    constructor() {
      this.adapter = new SiteAdapter(); this.manager = new FrameManager(this.adapter);
      this.views = new ViewController(this.manager, (text, error) => this.ui.showMessage(text, error), () => this.ui.update());
      this.downloads = new DownloadManager(this.manager, this.views, (text, error) => this.ui.showMessage(text, error), (busy, message) => this.ui.setProgress(busy, message));
      this.ui = new ToolbarUI(this.manager, this.views, (kind) => this.downloads.start(kind), () => this.downloads.cancel());
      this.refreshTimer = null; this.frameTick = null; this.started = false; this.pending = null;
      this.observer = new MutationObserver((records) => this.mutations(records));
      this.routeChanged = () => {
        const data = this.manager.data;
        if (data && data.route !== routeKey()) {
          this.retired = { root: data.root, signature: data.signature, route: data.route };
          this.invalidate('页面已切换，下载任务已取消');
        }
        this.schedule(0);
      };
      this.fullscreenChanged = () => this.schedule(0); this.visibilityChanged = () => this.schedule(0);
      this.pageHidden = () => this.stop();
    }
    start() {
      if (this.started) return; this.started = true;
      this.observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src', 'srcset', 'style', 'class', 'hidden', 'aria-hidden'] });
      window.addEventListener('popstate', this.routeChanged); window.addEventListener('hashchange', this.routeChanged);
      window.navigation?.addEventListener('currententrychange', this.routeChanged);
      document.addEventListener('fullscreenchange', this.fullscreenChanged); document.addEventListener('visibilitychange', this.visibilityChanged);
      window.addEventListener('pagehide', this.pageHidden, { once: true });
      this.refresh();
    }
    invalidate(reason) {
      this.downloads.cancel(reason); this.views.close(); this.manager.update(null); this.ui.unmount();
    }
    mutations(records) {
      let rescan = false; let frameChanged = false; const data = this.manager.data;
      for (const record of records) {
        const node = record.target;
        if (node instanceof Element && node.closest(OWN_SELECTOR)) continue;
        if (record.type === 'childList') {
          const external = [...record.addedNodes, ...record.removedNodes].some((child) => !(child instanceof Element && child.matches(OWN_SELECTOR)));
          if (external) rescan = true;
        } else if (data) {
          if (record.attributeName === 'src' || record.attributeName === 'srcset') {
            if (data.root.contains(node)) rescan = true;
          } else if (record.attributeName === 'style' && this.adapter.isFrame(node) && node.parentElement === data.root) {
            frameChanged = true;
          } else if (node === data.root || node.contains(data.root) || data.scope.contains(node)) {
            rescan = true;
          }
        } else if (node instanceof Element && (node.closest(FRAME_SELECTOR) || node.querySelector(FRAME_SELECTOR))) rescan = true;
      }
      if (data && data.route !== routeKey()) this.retired = { root: data.root, signature: data.signature, route: data.route };
      if (data && (rescan || data.route !== routeKey()) && !this.manager.valid()) this.invalidate('车型、颜色或视口已变化，下载任务已取消');
      if (rescan) this.schedule();
      if (frameChanged && !this.frameTick) {
        this.frameTick = requestAnimationFrame(() => { this.frameTick = null; this.ui.update(); });
      }
    }
    schedule(delay = 160) {
      if (this.refreshTimer !== null) return;
      this.refreshTimer = setTimeout(() => { this.refreshTimer = null; this.refresh(); }, delay);
    }
    refresh() {
      if (!this.started) return;
      const candidate = this.adapter.detect();
      if (candidate) {
        const signature = JSON.stringify(candidate.frames.map((frame) => frame.url));
        // pushState 后旧 DOM 可能暂留；直到新序列/容器到达才重新启用。
        if (this.retired && routeKey() !== this.retired.route && candidate.root === this.retired.root && signature === this.retired.signature) return;
        this.retired = null;
        if (candidate.root !== this.manager.data?.root || signature !== this.manager.data?.signature) {
          if (this.manager.data) this.invalidate('车型、颜色或视口已变化，下载任务已取消');
          if (!this.pending || this.pending.root !== candidate.root || this.pending.signature !== signature) {
            this.pending = { root: candidate.root, signature, since: performance.now() };
          }
          const remaining = 320 - (performance.now() - this.pending.since);
          if (remaining > 0) { this.schedule(Math.ceil(remaining)); return; }
        }
      }
      this.pending = null;
      const changed = this.manager.update(candidate);
      if (changed) { this.downloads.cancel('车型、颜色或视口已变化，下载任务已取消'); this.views.close(); }
      if (candidate) { this.ui.mount(candidate); this.ui.update(); } else this.ui.unmount();
    }
    stop() {
      this.started = false; clearTimeout(this.refreshTimer); this.refreshTimer = null; cancelAnimationFrame(this.frameTick); this.frameTick = null;
      this.observer.disconnect(); this.invalidate('页面已离开，下载任务已取消');
      window.removeEventListener('popstate', this.routeChanged); window.removeEventListener('hashchange', this.routeChanged);
      window.navigation?.removeEventListener('currententrychange', this.routeChanged);
      document.removeEventListener('fullscreenchange', this.fullscreenChanged); document.removeEventListener('visibilitychange', this.visibilityChanged);
    }
  }

  const app = new Application();
  window.addEventListener('pageshow', (event) => { if (event.persisted) app.start(); });
  app.start();
})();
