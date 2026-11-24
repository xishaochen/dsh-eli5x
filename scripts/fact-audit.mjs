#!/usr/bin/env node
/**
 * ELI5X · 数字可追溯性检查
 *
 * 用法：
 *   node scripts/fact-audit.mjs <讲解稿.html> <原文文本.txt> [--md]
 *
 * 做一件很窄但很有用的事：把讲解稿里的数字全部抠出来，逐个到原文里找。
 * 未命中的会被列出来 —— 它们要么删掉，要么改成「推算」，并写清算式。
 *
 * 注意：这是机械筛子，不是事实判断。命中≠正确（可能口径不同），未命中≠错误（可能是合理换算）。
 * 它的价值是逼你把每一个数字都过一遍原文，而不是让直觉过关。
 */
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const [htmlPath, srcPath] = args;
if (!htmlPath || !srcPath) {
  console.error('用法: node scripts/fact-audit.mjs <讲解稿.html> <原文文本.txt>');
  process.exit(2);
}

/** HTML → 纯文本（保留数字上下文） */
function toText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|td|th|text|figcaption)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ');
}

const srcText = toText(readFileSync(srcPath, 'utf8'));
const srcNorm = srcText.replace(/[\s,，]/g, '');

const htmlText = toText(readFileSync(htmlPath, 'utf8'));

/**
 * 抠数字：支持 1,432 / 14,332 / 8,092.12B / 91% / 35 万 / 1.1s / 2.3 倍 / 三（中文数字不计）
 * 只收「带量级或单位」或「≥3 位」的数字，避免把序号 01/02 当事实。
 */
const NUM_RE = /(\d[\d,]*(?:\.\d+)?)\s*(%|B|亿|万|千|倍|s|ms|美元|万元|人民币|人|个|条|次|家|篇|token|Token)?/g;

const rows = [];
const seen = new Set();
let m;
while ((m = NUM_RE.exec(htmlText)) !== null) {
  const raw = m[1];
  const unit = m[2] || '';
  const value = raw.replace(/,/g, '');
  if (!unit && value.replace('.', '').length < 3) continue; // 序号 / 小整数
  const key = value + unit;
  if (seen.has(key)) continue;
  seen.add(key);

  // 在原文里找：先找带单位的，再找纯数字
  const candidates = [
    raw, raw.replace(/,/g, ''), raw.replace(/,/g, ''),
    unit ? raw + unit : null,
    unit ? raw.replace(/,/g, '') + unit : null,
  ].filter(Boolean);

  let hit = false;
  let where = '';
  for (const c of candidates) {
    const idx = srcNorm.indexOf(c.replace(/[\s,，]/g, ''));
    if (idx >= 0) {
      hit = true;
      const from = Math.max(0, idx - 45);
      where = srcNorm.slice(from, idx + c.length + 25).replace(/\n/g, ' ');
      break;
    }
  }

  // 上下文（讲解稿里这句话在说什么）
  const at = htmlText.indexOf(m[0]);
  const ctx = htmlText.slice(Math.max(0, at - 50), at + m[0].length + 30).replace(/\s+/g, ' ').trim();

  rows.push({ value: key, hit, where, ctx });
}

const miss = rows.filter((r) => !r.hit);

console.log(`\n原文：${srcPath}（${srcNorm.length} 字符）`);
console.log(`讲解稿：${htmlPath}`);
console.log(`提取到 ${rows.length} 个数字，命中 ${rows.length - miss.length}，未命中 ${miss.length}\n`);

if (rows.length) {
  console.log('命中明细：');
  rows.filter((r) => r.hit).forEach((r) => {
    console.log(`  OK   ${r.value.padEnd(10)} ← …${r.where.slice(0, 70)}…`);
  });
}

if (miss.length) {
  console.log('\n未在原文命中（需处理：删除 / 标注为推算 / 补出处）：');
  miss.forEach((r) => {
    console.log(`  MISS ${r.value.padEnd(10)} 上下文：「${r.ctx.slice(0, 90)}」`);
  });
  console.log('\n结论：存在未追溯数字。按 SKILL.md 门 A 处理后再交付。');
  process.exit(1);
}

console.log('\n结论：PASS（所有数字均可在原文中定位）');
console.log('提醒：命中不等于口径一致。请人工确认单位、时间范围与统计口径是否有换算。');
