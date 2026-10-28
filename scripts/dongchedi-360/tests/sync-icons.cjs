'use strict';
// 维护工具：把已审核的官方 SVG 形状内嵌到可独立安装的脚本中，无运行时图标请求。
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const filename = path.join(root, 'dongchedi-360.user.js');
let source = fs.readFileSync(filename, 'utf8');
const icons = Object.fromEntries(Object.entries({ view: 'compass', download: 'download', copy: 'copy', car: 'car-front', chevron: 'chevron-down' }).map(([key, name]) => {
  const svg = fs.readFileSync(path.join(root, 'assets/lucide', name + '.svg'), 'utf8');
  const content = svg.slice(svg.indexOf('>') + 1, svg.lastIndexOf('</svg>')).trim().replace(/\s+/g, ' ');
  if (!content || /script|href=|onload=/i.test(content)) throw new Error('Unexpected SVG content: ' + name);
  return [key, content];
}));
let start = source.indexOf('  // BEGIN LUCIDE');
if (start < 0) start = source.indexOf('  // Lucide 0.468.0');
if (start < 0) start = source.indexOf('  const ICONS = ');
const end = source.indexOf('  const icon = ', start);
if (start < 0 || end < start) throw new Error('Icon markers missing');
const license = fs.readFileSync(path.join(root, 'assets/lucide/LICENSE'), 'utf8').trim();
source = source.slice(0, start) + '  // BEGIN LUCIDE 0.468.0 — official icons; sources: assets/lucide/\n  /*\n' + license.split(/\r?\n/).map((line) => '   * ' + line).join('\n') + '\n   */\n  const ICONS = Object.freeze(' + JSON.stringify(icons, null, 4) + ');\n  // END LUCIDE\n' + source.slice(end);
source = source.replaceAll('▾</span>', "' + icon('chevron') + '</span>");
fs.writeFileSync(filename, source);
