/**
 * eli5x — DSH skill provider：把本包自带的 SKILL.md 挂到 `ctx.skills`。
 *
 * 接线说明：DSH 插件要求 package.json 声明 `dsh.bundle` 并附 cordis.patch.yml；
 * 技能正文是一份 SKILL.md，它进入会话技能目录需要注册一个 provider，本文件就是这层薄接线。
 *
 * 三条刻意性质：
 *   · **不复制技能正文** — 候选与正文都在调用时从 SKILL.md 现读，改完立刻生效（watcher 触发 invalidate）。
 *   · **零依赖** — 只 import node: 内置模块。验收脚本是独立的 .mjs，由技能正文按需调用。
 *   · **rank=600（bundled）** — 若用户在 ~/.dsh/skills/eli5x 放了本地特化版（user-dsh=400），
 *     本地版胜出；插件不该覆盖用户自己的版本。
 *
 * 资源基准指向包根，因此技能正文里写的 `scripts/verify.mjs`、`assets/eli5x-template.html`
 * 都能按相对路径解析到随包分发的真实文件。
 *
 * @module dsh-eli5x
 */

import { watch } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/** 包根（lib/ 的上一级）。SKILL.md、scripts/、assets/、references/ 都在那里。 */
const ROOT_URL = new URL('..', import.meta.url)
const SKILL_URL = new URL('SKILL.md', ROOT_URL)
const SKILL_PATH = fileURLToPath(SKILL_URL)

/** 编辑器保存常连发事件，合并成一次目录失效。 */
const WATCH_DEBOUNCE_MS = 150

/** provider 名，在 ctx.skills 注册表里唯一。 */
const PROVIDER_NAME = 'eli5x'

/** bundled 档的秩（BUNDLED_SKILL_RANK = 600）。写常量而非 import，保持零依赖。 */
const RANK = 600

/**
 * 读 SKILL.md 的 YAML frontmatter。只认本技能用到的四个键，无需 YAML 依赖：
 * name / description / disable-model-invocation / user-invocable。
 * 其余键（如本技能声明工具范围的 allowed-tools 列表）按原文跳过，不参与解析。
 *
 * @param {string} text - SKILL.md 全文。
 * @returns {{fm: Record<string, string>, body: string}}
 */
export function parseFrontmatter(text) {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (!src.startsWith('---')) return { fm: {}, body: text }
  const end = src.indexOf('\n---', 3)
  if (end === -1) return { fm: {}, body: text }
  const fm = {}
  for (const line of src.slice(3, end).split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/)
    if (m && m[2] !== '') fm[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
  }
  return { fm, body: src.slice(end + 4).trimStart() }
}

/** 技能名必须匹配 DSH 的 kebab-case 语法。 */
export function isSkillName(name) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(name))
}

/** frontmatter 调用开关：省略即两处都开。 */
function invocationOf(fm) {
  return {
    modelInvocable: String(fm['disable-model-invocation'] ?? '').toLowerCase() !== 'true',
    userInvocable: String(fm['user-invocable'] ?? '').toLowerCase() !== 'false',
  }
}

/** 读候选：每次现读 SKILL.md。读失败不吞——拒绝比空数组诚实。 */
export async function list() {
  const { fm } = parseFrontmatter(await readFile(SKILL_URL, 'utf8'))
  if (!isSkillName(fm.name)) {
    throw new Error(`SKILL.md frontmatter name 非 kebab-case：${JSON.stringify(fm.name)}`)
  }
  if (!fm.description) throw new Error('SKILL.md frontmatter 缺少 description')
  return [
    {
      name: fm.name,
      description: fm.description,
      invocation: invocationOf(fm),
      provider: PROVIDER_NAME,
      source: 'bundled',
      // 资源基准指向包根：正文里的 scripts/verify.mjs、assets/ 等相对路径由此解析。
      resourceBase: { kind: 'directory', path: fileURLToPath(ROOT_URL) },
      rank: RANK,
      path: SKILL_PATH,
      locator: SKILL_URL,
    },
  ]
}

/** 读正文：frontmatter 已剥离。name 漂移时抛错让注册表重新发现。 */
export async function get(candidate) {
  const { fm, body } = parseFrontmatter(await readFile(SKILL_URL, 'utf8'))
  if (fm.name !== candidate.name) {
    throw new Error(`SKILL.md 的 name 已变为 ${JSON.stringify(fm.name)}，与候选 ${JSON.stringify(candidate.name)} 不符`)
  }
  return {
    name: candidate.name,
    description: fm.description || candidate.description,
    invocation: candidate.invocation,
    provider: PROVIDER_NAME,
    source: 'bundled',
    resourceBase: candidate.resourceBase,
    path: SKILL_PATH,
    content: body,
  }
}

/** 本 provider 实例（无内部状态：不缓存正文，全部现读）。 */
export const provider = { name: PROVIDER_NAME, list, get }

/** Cordis 插件名（与 cordis.patch.yml 的 id 一致）。 */
export const name = PROVIDER_NAME
/** 依赖的服务：技能注册表。 */
export const inject = ['skills']

/** 监听 SKILL.md 所在目录，改动后让注册表重读目录（幂等停止）。 */
function watchSkillFile(control, ctx) {
  if (typeof control?.invalidate !== 'function') return () => {}
  let timer
  let closed = false
  let watcher
  try {
    watcher = watch(fileURLToPath(ROOT_URL), { persistent: false }, (_event, filename) => {
      if (closed || (filename !== null && filename !== 'SKILL.md')) return
      if (timer !== undefined) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = undefined
        if (!closed) control.invalidate()
      }, WATCH_DEBOUNCE_MS)
    })
  } catch (error) {
    ctx?.logger?.warn?.(`eli5x: SKILL.md 监听未启动，修改后需重启：${error.message}`)
    return () => {}
  }
  const stop = () => {
    if (closed) return
    closed = true
    if (timer !== undefined) clearTimeout(timer)
    watcher.close()
  }
  watcher.on('error', (error) => {
    ctx?.logger?.warn?.(`eli5x: SKILL.md 监听停用：${error.message}`)
    stop()
  })
  control.signal?.addEventListener?.('abort', stop, { once: true })
  return stop
}

/** 挂载：把本 provider 注册到 ctx.skills。注册同步，发现与读正文都在 awaits。 */
export function apply(ctx) {
  ctx.skills.registerProvider((control) => {
    const stop = watchSkillFile(control, ctx)
    if (typeof ctx.effect === 'function') {
      ctx.effect(function* () {
        yield () => stop()
      }, 'eli5x skill watcher')
    }
    return provider
  })
}
