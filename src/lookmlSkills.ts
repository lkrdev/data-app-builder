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
  { id: 'looker-field-profiler', label: 'Field Value Profiler', desc: 'Profile string, number, yesno & datetime distributions, spikiness & LookML curation snippets via profile_fields', path: 'skills/looker-field-profiler/SKILL.md' },
] as const

export const LOOKML_TURN_SKILLS = LOOKML_SKILLS_CATALOG.slice(1, 6)
