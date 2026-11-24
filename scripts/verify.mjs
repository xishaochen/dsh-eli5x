#!/usr/bin/env node
/**
 * ELI5X · DOM 量测验收
 *
 * 用法：
 *   node scripts/verify.mjs <file.html> [更多文件...]
 *
 * 检查：多视口横溢出 / SVG 文字两两重叠 / 文字出 viewBox / JS 异常 / 动画节点点亮序列
 * 退出码 0 = 全绿，1 = 有失败项。
 *
 * 依赖：本机 Chrome（自动探测）+ Node 18+（内置 fetch / WebSocket）
 */
import { spawn } from 'node:child_process';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VIEWPORTS = [
  { w: 1440, h: 900, mobile: false },
  { w: 1080, h: 800, mobile: false },
  { w: 768, h: 900, mobile: false },
  { w: 390, h: 844, mobile: true },
];

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

const findChrome = () => {
  for (const p of CHROME_CANDIDATES) if (p && existsSync(p)) return p;
  return null;
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const port = 39000 + Math.floor(Math.random() * 900);

async function cdpNewTab() {
  const r = await fetch(`http://127.0.0.1:${port}/json/new`, { method: 'PUT' });
  return r.json();
}

async function connect() {
  const t = await cdpNewTab();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const pending = new Map();
  const errors = [];
  let id = 0;
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === 'Runtime.exceptionThrown') {
      errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    }
  });
  await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params }));
  });
  return { ws, send, errors };
}

const EVAL = `(() => {
  const out = { hScroll: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
                overflow: [], svgs: [], revealed: null };
  // 溢出元素（排除可横向滚动容器内部）
  document.querySelectorAll('body *').forEach(el => {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed') {
      let p = el.parentElement, inScroll = false;
      while (p && p !== document.body) {
        if (getComputedStyle(p).overflowX === 'auto') { inScroll = true; break; }
        p = p.parentElement;
      }
      if (!inScroll && out.overflow.length < 5) out.overflow.push(el.tagName + '.' + (el.className||'').toString().slice(0,24) + ' right=' + Math.round(b.right));
    }
  });
  // SVG 文字重叠与出界
  document.querySelectorAll('svg').forEach((svg, si) => {
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const ts = [...svg.querySelectorAll('text')].map(t => {
      const b = t.getBBox();
      return { t: t.textContent.trim().slice(0, 16), x: b.x, y: b.y, w: b.width, h: b.height };
    });
    const overlaps = [];
    for (let i = 0; i < ts.length; i++) for (let k = i + 1; k < ts.length; k++) {
      const a = ts[i], b = ts[k];
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 1.5 && iy > 1.5) overlaps.push([a.t, b.t, Math.round(ix) + '×' + Math.round(iy)]);
    }
    let outOfBox = 0;
    if (vb && vb.width) ts.forEach(t => { if (t.x + t.w > vb.width + 1 || t.y + t.h > vb.height + 1) outOfBox++; });
    out.svgs.push({ index: si, texts: ts.length, overlaps, outOfBox, vb: vb ? vb.width + 'x' + vb.height : null });
  });
  const rv = document.querySelectorAll('.rv');
  if (rv.length) out.revealed = document.querySelectorAll('.rv.in').length + '/' + rv.length;
  return out;
})()`;

/** 若页面含沿路径移动的点，采样阶段序列，验证节点依次点亮 */
const ANIM = `(() => {
  const dot = document.querySelector('[data-track-dot], #packet');
  const nodes = document.querySelectorAll('.node.on, [data-anim-node].on');
  const cap = document.querySelector('[data-anim-caption], #mcapT');
  let key = null;
  if (cap) key = cap.textContent.trim().slice(0, 40);
  else if (nodes.length) key = [...nodes].map(n => n.id || n.tagName).join('+');
  if (!dot || !key) return null;
  return JSON.stringify({ x: +dot.getAttribute('cx'), y: +dot.getAttribute('cy'), key });
})()`;

async function run(file) {
  const url = pathToFileURL(resolve(file)).href;
  const { ws, send, errors } = await connect();
  const fails = [];
  await send('Page.enable');
  await send('Runtime.enable');

  console.log(`\n=== ${file} ===`);

  for (const vp of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: vp.w, height: vp.h, deviceScaleFactor: 2, mobile: vp.mobile,
    });
    await send('Page.navigate', { url });
    await wait(1500);
    await send('Runtime.evaluate', {
      expression: `(() => { const s = document.body.scrollHeight; for (let y = 0; y < s; y += 500) window.scrollTo(0, y); window.scrollTo(0, 0); })()`,
    });
    await wait(600);

    const r = await send('Runtime.evaluate', { expression: EVAL, returnByValue: true });
    const v = r.result?.result?.value;
    if (!v) { fails.push(`${vp.w}px 无法求值`); continue; }

    const svgBad = v.svgs.filter((s) => s.overlaps.length || s.outOfBox);
    const ok = !v.hScroll && v.overflow.length === 0 && svgBad.length === 0;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${String(vp.w).padStart(4)}×${vp.h}  hScroll=${v.hScroll}` +
      `  overflow=${v.overflow.length}  svg=${v.svgs.length}个` +
      (v.revealed ? `  reveal=${v.revealed}` : '')
    );
    if (v.overflow.length) console.log('     溢出:', v.overflow.join(' | '));
    svgBad.forEach((s) => {
      if (s.overlaps.length) console.log(`     SVG#${s.index} 文字重叠 ${s.overlaps.length} 处:`, JSON.stringify(s.overlaps.slice(0, 5)));
      if (s.outOfBox) console.log(`     SVG#${s.index} 文字出 viewBox(${s.vb}) ${s.outOfBox} 个`);
    });
    if (!ok) fails.push(`${vp.w}px 排版问题`);
  }

  // 动画序列
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url });
  await wait(1500);
  await send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector('#globalmap, [data-anim-section]'); if (el) el.scrollIntoView({ block: 'center' }); })()`,
  });
  await wait(400);

  const seq = [];
  for (let i = 0; i < 40; i++) {
    const r = await send('Runtime.evaluate', { expression: ANIM, returnByValue: true });
    const val = r.result?.result?.value;
    if (val) {
      const s = JSON.parse(val);
      if (!seq.length || seq[seq.length - 1].key !== s.key) seq.push(s);
    }
    await wait(350);
  }
  if (seq.length) {
    console.log(`INFO 动画阶段序列（${seq.length} 段，采样 14s）:`);
    seq.slice(0, 24).forEach((s) => console.log(`     x=${s.x} y=${s.y}  ${s.key}`));
    if (seq.length < 3) { console.log('FAIL 动画阶段少于 3 段，可能未启动或只标了一个阶段'); fails.push('动画阶段不足'); }
    else console.log(`PASS 动画阶段可切换（${seq.length} 段）`);
  } else {
    console.log('INFO 未检出路径动画（本页可能为纯静态，跳过）');
  }

  if (errors.length) { console.log('FAIL JS 异常:', errors.slice(0, 3)); fails.push('JS 异常'); }
  else console.log('PASS JS 无异常');

  ws.close();
  return fails;
}

(async () => {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  if (!files.length) { console.error('用法: node scripts/verify.mjs <file.html> [...]'); process.exit(2); }
  const chrome = findChrome();
  if (!chrome) { console.error('未找到 Chrome，请设置 CHROME_PATH'); process.exit(2); }

  const profile = mkdtempSync(join(tmpdir(), 'eli5x-'));
  const proc = spawn(chrome, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, `--remote-debugging-port=${port}`, '--window-size=1440,900', 'about:blank',
  ], { stdio: 'ignore' });

  // 等 CDP 就绪
  for (let i = 0; i < 40; i++) {
    try { const r = await fetch(`http://127.0.0.1:${port}/json/version`); if (r.ok) break; } catch {}
    await wait(250);
  }

  let failed = 0;
  for (const f of files) {
    try { const fails = await run(f); if (fails.length) failed++; }
    catch (e) { console.error(`ERR ${f}: ${e.message}`); failed++; }
  }

  proc.kill('SIGKILL');
  try { rmSync(profile, { recursive: true, force: true }); } catch {}
  console.log(failed ? `\n结论：FAIL（${failed} 个文件未通过）` : '\n结论：PASS（全部检查通过）');
  process.exit(failed ? 1 : 0);
})();
