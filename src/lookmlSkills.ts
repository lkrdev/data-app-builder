export interface LookmlSkillCatalogEntry {
  id: string
  label: string
  desc: string
  path: string
}

export const LOOKML_SKILLS_CATALOG: readonly LookmlSkillCatalogEntry[] = [
  { id: 'looker-project-onboarding', label: 'Project Onboarding', desc: 'Onboard a new LookML project, bare Git repo, model, base views & 5-layer measure refinements from a Looker DB connection', path: 'skills/looker-project-onboarding/SKILL.md' },
  { id: 'lookml-field-curation', label: 'Descriptions & Curation', desc: 'Profile string fields, curate descriptions, group_label & hidden flags', path: 'skills/lookml-field-curation/SKILL.md' },
  { id: 'lookml-tests', label: 'Data Tests (.test.lkml)', desc: 'Author & run assert-based LookML data tests via run_lookml_test', path: 'skills/lookml-tests/SKILL.md' },
  { id: 'lookml-snapshot', label: 'Snapshot & Parity', desc: 'Capture lkr parse lookml snapshot & verify SQL-to-Explore parity', path: 'skills/lookml-snapshot/SKILL.md' },
  { id: 'generate-view-from-table', label: 'Bronze View', desc: 'Scaffold or refresh Bronze base views from table metadata', path: 'skills/generate-view-from-table/SKILL.md' },
  { id: 'agentic-lookml-workflow', label: 'SQL Workflow', desc: 'Full SQL-to-LookML Bronze refinement + Silver/Gold layer workflow', path: 'skills/agentic-lookml-workflow/SKILL.md' },
  { id: 'looker-field-profiler', label: 'Field Value Profiler', desc: 'Profile field distributions, spikiness, LookML curation snippets & _field_value_search_<model> search index PDTs', path: 'skills/looker-field-profiler/SKILL.md' },
] as const

export const LOOKML_TURN_SKILLS = LOOKML_SKILLS_CATALOG.slice(1, 6)

export const STUDIO_SLASH_SKILLS: readonly LookmlSkillCatalogEntry[] = [
  ...LOOKML_SKILLS_CATALOG,
  { id: 'looker-dashboard', label: 'Looker Dashboard', desc: 'Author & update 24-column UDDs, LookML dashboards, Saved Looks, Boards & Schedules', path: 'skills/looker-dashboard/SKILL.md' },
  { id: 'key-driver-analysis', label: 'Key Driver Analysis', desc: 'Run & recursively drill Looker Key Driver Analysis (run_key_driver_analysis)', path: 'skills/key-driver-analysis/SKILL.md' },
  { id: 'data-investigator', label: 'Data Investigator', desc: 'Build root-cause narrative Data Apps in Doc or Slides format with fixed date windows', path: 'skills/data-investigator/SKILL.md' },
  { id: 'data-apps', label: 'Lit Data Apps', desc: 'Build interactive Lit web component Data Apps with KPIs, charts, grids & controls', path: 'skills/data-apps/SKILL.md' },
] as const

const KNOWN_SLASH_SKILL_IDS = new Set(STUDIO_SLASH_SKILLS.map((s) => s.id))

export function extractSlashSkillIds(text?: string): string[] {
  if (!text) return []
  const matches = Array.from(String(text).matchAll(/(?:^|\s)\/([a-z0-9_-]+)(?=\s|$|[.,;!?])/gi))
  return Array.from(new Set(matches.map((m) => m[1].toLowerCase()).filter((id) => KNOWN_SLASH_SKILL_IDS.has(id))))
}

