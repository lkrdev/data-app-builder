#!/usr/bin/env node
// ponytail: deterministic stdlib packer for .agents/skills/* -> src/sandboxSkillsBundle.ts (--check verifies byte-parity)
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..')
const skillsRoot = path.join(repoRoot, '.agents/skills')
const outPath = path.join(repoRoot, 'src/sandboxSkillsBundle.ts')
const checkOnly = process.argv.includes('--check')

const EXCLUDED_DIRS = new Set(['data-apps-sync', 'issue-authoring', 'studio-conversation-debugger', 'studio-design-system', 'looker-dashboard'])
const EXCLUDED_FILES = new Set(['looker-field-profiler/SKILL.md'])
const SCRUB_RULES = [
  [/looker-private-demo/gi, 'analytics-prod'],
  [/default_bigquery_connection/gi, 'bigquery_connection'],
  [/argolis_scratch/gi, 'analytics_scratch'],
  [/demowest/gi, 'looker_instance'],
  [/thelook/gi, 'ecommerce'],
]
const B62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const codeOf = (i) => B62[Math.floor(i / 62)] + B62[i % 62]
const cmpAsc = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

const relPaths = []
const walk = (dir, prefix = '') => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === '__pycache__') continue
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (!prefix && EXCLUDED_DIRS.has(entry.name)) continue
      walk(path.join(dir, entry.name), rel)
    } else if (!EXCLUDED_FILES.has(rel)) {
      relPaths.push(rel)
    }
  }
}
walk(skillsRoot)
// ponytail: sort full relPaths by code unit so top-level lookml-* ('-') precedes lookml/sub-skills/* ('/') on ??= registration
relPaths.sort(cmpAsc)

const docs = relPaths.map((rel) => {
  const full = path.join(skillsRoot, rel)
  const raw = readFileSync(full, 'utf8').replace(/\r\n/g, '\n')
  const scrubbed = SCRUB_RULES.reduce((txt, [re, rep]) => txt.replace(re, rep), raw)
  if (scrubbed !== raw) {
    if (checkOnly) throw new Error(`Banned demo identifier in .agents/skills/${rel}; run npm run pack-skills`)
    console.error(`pack-skills: scrubbed demo identifiers in .agents/skills/${rel}`)
    writeFileSync(full, scrubbed, 'utf8')
  }
  if (/[\x01\x02]/.test(scrubbed)) throw new Error(`Unsupported control byte in .agents/skills/${rel}`)
  return scrubbed
})

const dict = []
let stream = docs.map((d) => d.replace(/~/g, '~~')).join('\x01')
const rankCandidates = (counts, minSave, limit) =>
  [...counts.entries()]
    .map(([k, n]) => [k, n * (k.length - 3) - 7])
    .filter(([, save]) => save > minSave)
    .sort((a, b) => b[1] - a[1] || cmpAsc(a[0], b[0]))
    .slice(0, limit)

const lineCounts = new Map()
for (const ln of stream.split('\n')) {
  if (ln.length >= 12 && !ln.includes('\x01') && !ln.includes('~')) lineCounts.set(ln, (lineCounts.get(ln) || 0) + 1)
}
const lineMap = new Map(rankCandidates(lineCounts, 16, 1400).map(([ln]) => [ln, `~${codeOf(dict.push(ln) - 1)}`]))
stream = stream.split('\n').map((ln) => lineMap.get(ln) ?? ln).join('\n')

const p1Len = dict.length
let combined = `${dict.join('\x02')}\x02${stream}`
const tokRe = /~(?:[0-9a-zA-Z]{2}|~)|[A-Za-z0-9_./:-]{4,}/g
const tokCounts = new Map()
for (const [tok] of combined.matchAll(tokRe)) if (!tok.startsWith('~')) tokCounts.set(tok, (tokCounts.get(tok) || 0) + 1)
const tokMap = new Map(rankCandidates(tokCounts, 12, 3844 - p1Len).map(([tok]) => [tok, `~${codeOf(dict.push(tok) - 1)}`]))
combined = combined.replace(tokRe, (m) => (m.startsWith('~') ? m : (tokMap.get(m) ?? m)))
const parts = combined.split('\x02')
stream = parts.pop()
for (let i = 0; i < p1Len; i += 1) dict[i] = parts[i]

const idxOf = (k) => B62.indexOf(k[0]) * 62 + B62.indexOf(k[1])
const d1 = stream.replace(/~([0-9a-zA-Z]{2}|~)/g, (m, k) => (k === '~' ? '~~' : idxOf(k) < p1Len ? dict[idxOf(k)] : m))
const decoded = d1.replace(/~([0-9a-zA-Z]{2}|~)/g, (_, k) => (k === '~' ? '~' : dict[idxOf(k)])).split('\x01')
if (decoded.length !== docs.length || decoded.some((d, i) => d !== docs[i])) throw new Error('Round-trip verification failed')

const rendered = `// Auto-generated lossless sandbox skill bundle for .agents/skills/* (ponytail: 2-pass Base62 dictionary keeps dist/bundle.js < 2 MiB)
const _B62 = '${B62}'
const _C: string[] = ${JSON.stringify(dict)}
const _P: string[] = ${JSON.stringify(relPaths)}
const _S = ${JSON.stringify(stream)}
const _idx = (k: string): number => _B62.indexOf(k[0]) * 62 + _B62.indexOf(k[1])
const _d1 = _S.replace(/~([0-9a-zA-Z]{2}|~)/g, (m, k: string) => (k === '~' ? '~~' : _idx(k) < ${p1Len} ? _C[_idx(k)] : m))
const _docs = _d1.replace(/~([0-9a-zA-Z]{2}|~)/g, (_, k: string) => (k === '~' ? '~' : _C[_idx(k)])).split('\\x01')

export const SANDBOX_AGENT_SKILL_FILES: Record<string, string> = Object.fromEntries(
  _P.map((relPath, idx) => [relPath, _docs[idx]])
)
`

if (checkOnly) {
  if (readFileSync(outPath, 'utf8') !== rendered) {
    console.error('src/sandboxSkillsBundle.ts is out of date. Run: npm run pack-skills')
    process.exit(1)
  }
} else {
  writeFileSync(outPath, rendered, 'utf8')
}
