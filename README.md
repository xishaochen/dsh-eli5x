# dsh-eli5x

A DeepSeek Harness skill plugin that turns complex technical or product material into a
**self-contained, animated HTML explainer written for non-technical readers** — and then
forces the result through a fact check before it is delivered.

`ELI5X` = *Explain Like I'm 5, eXtended*. Three X's, three stages:

| X | What it does | What it prevents |
|---|---|---|
| e**X**plain | one master analogy carries the whole document, plus an explicit mapping table | pretty metaphors that teach nothing, and analogies mistaken for facts |
| e**X**pand | fixed six-section skeleton + one animated end-to-end flow diagram | understanding the parts but never the whole |
| e**X**amine | a fact ledger and two mechanical gates | numbers with no source, and layout faults nobody can see |

## 中文摘要

把「作者自己看得懂」的材料，变成「外行看得懂、且每句话都站得住」的可交互 HTML。

三步：单一主类比讲透机制 → 六段骨架 + 一张动态全局图 → 事实账本 + DOM 量测验收。

产出是**单文件自包含 HTML**（CSS/JS/数据全部内联，双击即开，手机可读）。

## Install

```bash
dsh plugin add dsh-eli5x
# or from a checkout:
dsh plugin add github:xishaochen/dsh-eli5x
```

After install, the skill `eli5x` is available in every session. Ask for it in plain language
("explain this to a non-technical colleague", "turn this article into an animated explainer",
"ELI5 the architecture") or invoke it directly.

## What is inside

```
├── SKILL.md                     the skill: 5 stages, 7 hard rules, 7 anti-patterns
├── assets/eli5x-template.html   starting template (verified CSS, motion, a11y)
├── references/structure.md      section-by-section writing guide with sample sentences
├── references/analogy-design.md how to pick one analogy that survives the whole document
├── scripts/verify.mjs           layout gate: viewports, text overlap, JS errors, animation
└── scripts/fact-audit.mjs       traceability gate: every number must exist in the source
```

### The two gates

`scripts/verify.mjs` drives a local headless Chrome over CDP and checks, at 1440 / 1080 / 768 / 390 px:

- no horizontal overflow
- no two `<text>` elements inside any SVG overlap (bounding-box intersection > 1.5 px)
- no text outside the SVG `viewBox`
- no JS exceptions
- the path animation lights its stages in sequence (samples the caption/active node over 14 s)

`scripts/fact-audit.mjs` extracts every number from the explainer and searches for it in the
source text. Anything not found verbatim is reported — it must be deleted, or relabelled as an
estimate with the arithmetic shown.

```bash
node scripts/verify.mjs my-explainer.html
node scripts/fact-audit.mjs my-explainer.html source.txt
```

Both exit non-zero on failure, so they can be wired into CI.

### Requirements

Node 18+ (built-in `fetch` / `WebSocket`) and a local Chrome/Chromium for `verify.mjs`.
Set `CHROME_PATH` if it is not in a standard location. `fact-audit.mjs` needs no browser.

## Design notes

- **One analogy only.** Switching analogies mid-document forces the reader to rebuild their
  mental model — which is exactly when they stop reading.
- **The return path is drawn as a different route from the outbound path.** A request is
  *rewritten* on the way out and *reassembled* on the way back; drawing one line for a round
  trip erases that difference.
- **The terminology table and the diagram must agree.** Every name in the table needs an
  anchor that actually lights up in the animation. A concept explained in prose but missing
  from the diagram is the most common failure of this genre, and it is invisible to the eye.
- **Attribution is a refusal line.** When material about project A is used to describe a role
  in project B, the skill refuses to write "I built this" — only "what is worth borrowing here".
- **Never judge layout from a full-page screenshot.** On dense diagrams with small type,
  image-based review reports overlapping text where measurement finds zero overlaps. Measure.

## License

MIT

## Repository

https://github.com/xishaochen/dsh-eli5x
