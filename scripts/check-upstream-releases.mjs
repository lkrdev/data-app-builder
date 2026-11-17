#!/usr/bin/env node
// Zero-LLM upstream release parity watcher for looker-open-source/looker-cli and looker-open-source/looker-skills.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const repoRoot = path.resolve(import.meta.dirname, '..'), args = process.argv.slice(2)
const getFlag = (p) => args.find((a) => a.startsWith(p))?.slice(p.length)
const ackTarget = getFlag('--ack=') || (args.includes('--ack') ? 'all' : ''), isDryRun = args.includes('--dry-run')
const versionsPath = path.resolve(getFlag('--versions=') || path.join(repoRoot, 'upstream-versions.json'))
const fixturesArg = getFlag('--fixtures=') || process.env.UPSTREAM_PARITY_FIXTURES || ''
const EXCLUDED_SKILLS = ['looker-mcp-skill', 'installing-looker-cli', 'authenticating-looker-cli', 'using-looker-cli', 'connecting-looker-to-bigquery']

const fetchJson = async (url, allow404 = false) => {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || ''
  const headers = Object.assign({ Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'data-app-builder-upstream-watcher' }, token ? { Authorization: `Bearer ${token}` } : null)
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) })
  if (allow404 && res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub API ${res.status} for ${url}`)
  return res.json()
}
const isNewerTag = (cur, next, release) => {
  if (!next || next === cur || release?.draft || release?.prerelease) return false
  const a = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(cur)?.slice(1).map(Number), b = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(next)?.slice(1).map(Number)
  return a && b ? b[0] > a[0] || (b[0] === a[0] && (b[1] > a[1] || (b[1] === a[1] && b[2] > a[2]))) : next !== cur
}
const mapSkillCounterparts = (file) => {
  const s = /^skills\/([^/]+)\//.exec(file)?.[1]
  if (!s) return '`.agents/skills/*`, `src/lkrCliBridge.ts`, `src/lookerPermissions.ts`, `scripts/run-evals.mjs`'
  if (s === 'creating-looker-dashboard') return '`skills/looker-dashboard/SKILL.md`, `.agents/skills/looker-dashboard/SKILL.md`, `src/antigravityStarters.ts`, `scripts/run-evals.mjs`'
  if (s === 'lookml-modeling-guidelines' || s === 'looker-architect') return '`.agents/skills/agentic-lookml/SKILL.md`, `src/sandboxSkillsBundle.ts`, `scripts/run-evals.mjs`'
  if (s === 'looker-audit') return '`.agents/skills/looker-audit/SKILL.md`, `src/lkrCliBridge.ts`, `src/lookerPermissions.ts`, `scripts/run-evals.mjs`'
  return `\`.agents/skills/${s}/SKILL.md\`, \`src/sandboxSkillsBundle.ts\`, \`src/lookerPermissions.ts\`, \`scripts/run-evals.mjs\``
}
const buildIssueBody = ({ repo, fromLabel, toLabel, ver, url, summary, rows }) => [
  `<!-- upstream-parity:${repo}:${ver} -->\n## Upstream Release Summary\n`,
  `- **Upstream Repository**: \`looker-open-source/${repo}\`\n- **Baseline → Latest**: \`${fromLabel}\` → \`${toLabel}\`\n- **Compare / Release URL**: ${url}\n`,
  `${summary.trim() || '_No release summary provided._'}\n\n## Changed Upstream Paths → Local \`data-app-builder\` Counterparts\n`,
  `| Upstream Path / Surface | Local \`data-app-builder\` Counterparts |\n| --- | --- |\n${rows.map(([src, dst]) => `| \`${String(src).replace(/\|/g, '\\|')}\` | ${dst} |`).join('\n')}\n`,
  '## Out-of-Scope Filter Reminder\n\n- **No MCP**: Ignore MCP server/tool features and `looker-mcp-skill`.\n- **No Go `looker-cli` binary in `/workspace/`**: Port worthwhile workflows into browser/WASM `LkrCodeMode` (`src/lkrCliBridge.ts`), `.agents/skills/*`, or `src/lookerPermissions.ts` — never install or shell out to the Go `looker-cli` binary in `/workspace/`.\n- **Bundle Budget**: Keep `dist/bundle.js < 2.00 MiB`.\n',
  `## Verification\n\n- [ ] Implement relevant parity changes or close this issue as \`not planned\` to suppress \`${repo}:${ver}\`.\n- [ ] \`node scripts/check-upstream-releases.mjs --ack\`\n- [ ] \`npx jest src/__tests__/permissions.test.ts && node scripts/test-bundle.mjs && npm run eval\``,
].join('\n')

const fixture = fixturesArg ? JSON.parse(readFileSync(path.resolve(fixturesArg), 'utf8')) : null
const versions = fixture?.versions || JSON.parse(readFileSync(versionsPath, 'utf8'))
const cliRelease = fixture?.cliRelease || (await fetchJson('https://api.github.com/repos/looker-open-source/looker-cli/releases/latest'))
const skillsCompare = 'skillsCompare' in (fixture || {}) ? fixture.skillsCompare : await fetchJson(`https://api.github.com/repos/looker-open-source/looker-skills/compare/${versions.lookerSkillsSha}...HEAD`, true)
const headFallbackSha = !skillsCompare || (skillsCompare.total_commits || 0) > (skillsCompare.commits?.length || 0) ? (fixture?.skillsHeadSha || (await fetchJson('https://api.github.com/repos/looker-open-source/looker-skills/commits/HEAD')).sha) : ''
const latestCliTag = String(cliRelease?.tag_name || '').trim() || versions.lookerCliTag
const latestSkillsSha = String(headFallbackSha || skillsCompare?.commits?.at(-1)?.sha || skillsCompare?.base_commit?.sha || versions.lookerSkillsSha).trim()
if (ackTarget) {
  if (!['all', 'looker-cli', 'looker-skills'].includes(ackTarget)) throw new Error(`Invalid --ack target: ${ackTarget}`)
  const next = { lookerCliTag: ackTarget === 'looker-skills' ? versions.lookerCliTag : latestCliTag, lookerSkillsSha: ackTarget === 'looker-cli' ? versions.lookerSkillsSha : latestSkillsSha }
  if (!isDryRun) writeFileSync(versionsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  console.log(JSON.stringify({ acknowledged: next, dryRun: isDryRun }))
  process.exit(0)
}

const candidates = []
if (isNewerTag(versions.lookerCliTag, latestCliTag, cliRelease)) {
  const compareUrl = `https://github.com/looker-open-source/looker-cli/compare/${versions.lookerCliTag}...${latestCliTag}`
  const rows = [[`looker-cli ${latestCliTag}`, '`src/lkrCliBridge.ts`, `.agents/skills/*`, `src/lookerPermissions.ts`, `scripts/run-evals.mjs`']]
  candidates.push({ repo: 'looker-cli', ver: latestCliTag, title: `chore(upstream-parity): looker-open-source/looker-cli ${latestCliTag}`, body: buildIssueBody({ repo: 'looker-cli', fromLabel: versions.lookerCliTag, toLabel: latestCliTag, ver: latestCliTag, url: cliRelease.html_url ? `${cliRelease.html_url} ([compare](${compareUrl}))` : compareUrl, summary: String(cliRelease.body || '').slice(0, 3000), rows }) })
}
const skillFiles = (skillsCompare?.files || []).map((f) => f?.filename).filter((f) => f && !EXCLUDED_SKILLS.some((s) => f.startsWith(`skills/${s}/`)))
if (latestSkillsSha !== versions.lookerSkillsSha && skillsCompare?.status !== 'behind' && skillsCompare?.status !== 'identical' && (!skillsCompare?.files || skillFiles.length > 0 || skillsCompare.files.length >= 300)) {
  const sFrom = versions.lookerSkillsSha.slice(0, 7), sTo = latestSkillsSha.slice(0, 7)
  const commitsMd = (skillsCompare?.commits || []).slice(0, 15).map((c) => `- \`${String(c.sha || '').slice(0, 7)}\` ${String(c.commit?.message || '').split('\n')[0]}`).join('\n')
  const rows = (skillFiles.length ? skillFiles.slice(0, 25) : [`looker-skills ${sFrom}...${sTo}`]).map((f) => [f, mapSkillCounterparts(f)])
  candidates.push({ repo: 'looker-skills', ver: latestSkillsSha, title: `chore(upstream-parity): looker-open-source/looker-skills ${sFrom}...${sTo}`, body: buildIssueBody({ repo: 'looker-skills', fromLabel: sFrom, toLabel: sTo, ver: latestSkillsSha, url: skillsCompare?.html_url || `https://github.com/looker-open-source/looker-skills/compare/${versions.lookerSkillsSha}...${latestSkillsSha}`, summary: commitsMd, rows }) })
}

const gh = (ghArgs) => execFileSync(process.env.GH_BIN || 'gh', ghArgs, { encoding: 'utf8' }), hasMarker = (b, p) => String(b || '').trimStart().startsWith(p)
const issues = candidates.length ? (Array.isArray(fixture?.issues) ? fixture.issues : JSON.parse(gh(['issue', 'list', '--state', 'all', '--search', 'upstream-parity in:body', '--json', 'number,title,state,body', '--limit', '200']) || '[]')) : []
let labelEnsured = false
const actions = []
for (const c of candidates) {
  if (issues.some((i) => hasMarker(i.body, `<!-- upstream-parity:${c.repo}:${c.ver} -->`))) { actions.push({ action: 'noop', reason: 'marker-exists', repo: c.repo, ver: c.ver }); continue }
  const openIssue = issues.find((i) => String(i.state || '').toUpperCase() === 'OPEN' && hasMarker(i.body, `<!-- upstream-parity:${c.repo}:`))
  if (openIssue) {
    if (!isDryRun) gh(['issue', 'edit', String(openIssue.number), '--title', c.title, '--body', c.body])
    actions.push({ action: 'edit', repo: c.repo, ver: c.ver, number: openIssue.number, title: c.title, body: c.body })
  } else {
    if (!isDryRun && !labelEnsured && (labelEnsured = true)) gh(['label', 'create', 'upstream-parity', '--color', '0e8a16', '--description', 'Upstream looker-cli / looker-skills release parity', '--force'])
    const url = isDryRun ? '' : gh(['issue', 'create', '--label', 'upstream-parity', '--title', c.title, '--body', c.body]).trim()
    actions.push({ action: 'create', repo: c.repo, ver: c.ver, title: c.title, url, body: c.body })
  }
}
console.log(JSON.stringify({ actions }, null, 2))
