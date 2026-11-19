import type { IContentSummary, IRequestContentSummary, Looker40SDK } from '@looker/sdk'

import { callInteractionsApi } from './antigravityAuth'
import {
  type AntigravityAuth, type AntigravityExtensionHostLike, type AntigravityInteractionOutput,
  collectInteractionTextCandidates, DEFAULT_ANTIGRAVITY_MODEL, DEFAULT_POLL_SCHEDULE_MS,
} from './antigravityTypes'
import { LkrCodeMode } from './lkrCliBridge'
import { parseExploreId } from './lookerTransport'

export const CONVERSATION_LABEL_REQUEST_TAG = '[CONVERSATION_LABEL_REQUEST]'
export const STARTER_PROMPTS_REQUEST_TAG = '[STARTER_PROMPTS_REQUEST]'

function extractCleanLabelWords(input?: string): string[] {
  const firstLine = String(input || '')
    .replace(/\[CONVERSATION_LABEL_REQUEST\]/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .split(/\r?\n/)
    .map((l) => l.replace(/^(?:label|title)\s*:\s*/i, '').replace(/^[#>*\-\s"'`“”‘’]+|[#*`"'“”‘’.\s:;!?-]+$/g, '').replace(/[*_`~"]/g, '').trim())
    .find(Boolean) || ''
  return firstLine.split(/\s+/).map((w) => w.replace(/^[("'“‘]+|[)"'”’.,:;!?-]+$/g, '')).filter(Boolean)
}

export function sanitizeConversationLabel(raw: string, fallbackPrompt?: string): string {
  const words = extractCleanLabelWords(raw)
  if (words.length >= 3) return words.slice(0, 6).join(' ')
  const combined = [...words, ...extractCleanLabelWords(fallbackPrompt).filter((w) => !words.includes(w))]
  return combined.length >= 3 ? combined.slice(0, 6).join(' ') : [...combined, 'Looker', 'Studio', 'Conversation'].slice(0, 3).join(' ')
}

export const STARTER_PROMPTS_RESPONSE_FORMAT = {
  type: 'json_schema',
  mime_type: 'application/json',
  schema: {
    type: 'array',
    items: {
      type: 'object',
      properties: { id: { type: 'string' }, label: { type: 'string' }, prompt: { type: 'string' } },
      required: ['id', 'label', 'prompt'],
    },
  },
}

async function runStatelessPrompt(params: {
  extensionSDK: AntigravityExtensionHostLike; auth: AntigravityAuth; environmentId?: string; model?: string
  pollScheduleMs?: number[]; inputText: string; systemInstruction?: string
  responseFormat?: Record<string, unknown>; generationConfig?: Record<string, unknown>
}): Promise<string> {
  const {
    extensionSDK, auth, model = DEFAULT_ANTIGRAVITY_MODEL, pollScheduleMs = DEFAULT_POLL_SCHEDULE_MS, inputText,
    systemInstruction = 'You are a concise stateless Looker Data App Studio assistant. Do not call any tools.',
    responseFormat, generationConfig,
  } = params
  let interaction = await callInteractionsApi(extensionSDK, auth, 'interactions', 'POST', {
    model: model || DEFAULT_ANTIGRAVITY_MODEL, store: false, background: false, tools: [],
    system_instruction: systemInstruction,
    generation_config: generationConfig || { thinking_level: 'low', max_output_tokens: 1024 },
    ...(responseFormat ? { response_format: responseFormat } : {}),
    input: [{ type: 'text', text: inputText }],
  })
  const schedule = pollScheduleMs.length > 0 ? pollScheduleMs : DEFAULT_POLL_SCHEDULE_MS
  for (let i = 0; interaction?.id && (interaction.status === 'in_progress' || interaction.status === 'queued'); i++) {
    const sleepMs = schedule[Math.min(i, schedule.length - 1)]
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs))
    interaction = await callInteractionsApi(extensionSDK, auth, `interactions/${encodeURIComponent(interaction.id)}`, 'GET')
  }
  return interaction?.output_text || (interaction?.outputs || []).map((o: AntigravityInteractionOutput) => o?.text || '').join('\n') || collectInteractionTextCandidates(interaction)
}

// ponytail: stateless out-of-band labeling request — uses direct model inference with store: false,
// omits previous_interaction_id, and passes tools: [] so it never enters the conversation chain or locks a container.
export async function generateConversationLabel(params: {
  extensionSDK: AntigravityExtensionHostLike; auth: AntigravityAuth; environmentId?: string
  userPrompt: string; assistantText?: string; model?: string; pollScheduleMs?: number[]
}): Promise<string> {
  const cleanUser = String(params.userPrompt || '').replace(/\s+/g, ' ').trim().slice(0, 280)
  const cleanAssistant = String(params.assistantText || '').replace(/\s+/g, ' ').trim().slice(0, 280)
  const inputText = [
    `${CONVERSATION_LABEL_REQUEST_TAG} Return only a single-line concise 3-6 word plain-text title for this conversation turn (no quotes, no markdown, no trailing period, no tools):`,
    `User: ${cleanUser}`,
    ...(cleanAssistant ? [`Assistant: ${cleanAssistant}`] : []),
  ].join('\n')
  try {
    return sanitizeConversationLabel(
      await runStatelessPrompt({
        ...params, inputText,
        systemInstruction: 'Return only a single-line concise 3-6 word plain-text title for this Looker Studio conversation turn without quotes, markdown, trailing period, or tags.',
      }),
      params.userPrompt
    )
  } catch {
    return sanitizeConversationLabel('', params.userPrompt)
  }
}

export interface StarterPromptItem { id: string; label: string; prompt: string }
export interface StarterExploreFieldSummary { name: string; label?: string; type?: string }
export type StarterContentSummaryItem = Pick<
  IContentSummary,
  'id' | 'content_type' | 'content_id' | 'content_slug' | 'title' | 'description' | 'view_count' | 'favorite_count' | 'is_scheduled'
>
export interface StarterExploreContext {
  exploreKey: string; modelName: string; modelLabel: string; exploreName: string; exploreLabel: string
  dimensions: StarterExploreFieldSummary[]; measures: StarterExploreFieldSummary[]; contentSummaries?: StarterContentSummaryItem[]
}
export interface LookmlModelExploreSummaryLike {
  name?: string | null; label?: string | null; project_name?: string | null
  explores?: Array<{ name?: string | null; label?: string | null; description?: string | null; hidden?: boolean | null }> | null
}
export interface BuildDynamicStarterPromptsOptions {
  selectedExplores?: string[]; canDevelopLookml?: boolean
  availableModels?: LookmlModelExploreSummaryLike[]; exploreContext?: StarterExploreContext | null; contentSummaries?: StarterContentSummaryItem[]
}

const starterExploreContextCache = new Map<string, StarterExploreContext>()
const starterPromptsCache = new Map<string, StarterPromptItem[]>()
let starterContentSummariesCache: StarterContentSummaryItem[] | null = null

export function clearStarterPromptsCache(): void {
  starterExploreContextCache.clear(); starterPromptsCache.clear(); starterContentSummariesCache = null
}

export function stripStarterPromptEmojis(text: string): string {
  return String(text || '')
    .replace(/(?:[\p{Extended_Pictographic}\p{Emoji_Presentation}\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2300}-\u{23FF}\u{2B00}-\u{2BFF}]|\uFE0E|\uFE0F|\u200D)+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function humanizeLookmlIdentifier(raw?: string | null): string {
  const clean = String(raw || '').trim().replace(/^[^.]+\./, '').replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clean ? clean.split(' ').map((w) => (w.length <= 2 && /^(?:id|pk|bq|qa|ai)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ') : ''
}

export function buildStarterPromptsCacheKey(exploreKey?: string, canDevelopLookml = true, isAgentAuthenticated = false): string {
  const exp = String(exploreKey || 'none').trim() || 'none'
  return `${exp}::${canDevelopLookml ? 'dev' : 'explore'}::${isAgentAuthenticated ? 'agent' : 'local'}`
}

export function getCachedStarterPrompts(exploreKey?: string, canDevelopLookml = true, isAgentAuthenticated = false): StarterPromptItem[] | undefined {
  return starterPromptsCache.get(buildStarterPromptsCacheKey(exploreKey, canDevelopLookml, isAgentAuthenticated))
}

export function resolveTargetExploreFromModels(
  selectedExplores?: string[],
  availableModels?: LookmlModelExploreSummaryLike[]
): { exploreKey: string; modelName: string; modelLabel: string; exploreName: string; exploreLabel: string } | null {
  const validModels = (Array.isArray(availableModels) ? availableModels : []).filter((m) => m && typeof m.name === 'string' && m.name.trim().length > 0)
  const mkTarget = (modelName: string, exploreName: string, mLabel?: string | null, eLabel?: string | null) => ({
    exploreKey: `${modelName}::${exploreName}`, modelName,
    modelLabel: String(mLabel || humanizeLookmlIdentifier(modelName)), exploreName,
    exploreLabel: String(eLabel || humanizeLookmlIdentifier(exploreName)),
  })
  const firstSelected = (Array.isArray(selectedExplores) ? selectedExplores : []).map((s) => String(s || '').trim()).find(Boolean)
  if (firstSelected) {
    const parsed = parseExploreId(firstSelected) || (firstSelected.includes('/') ? { modelName: firstSelected.split('/')[0].trim(), exploreName: firstSelected.split('/')[1].trim() } : null)
    if (parsed?.modelName && parsed.exploreName) {
      const matchedModel = validModels.find((m) => String(m.name).trim() === parsed.modelName)
      const matchedExplore = (matchedModel?.explores || []).find((e) => String(e?.name || '').trim() === parsed.exploreName)
      return mkTarget(parsed.modelName, parsed.exploreName, matchedModel?.label, matchedExplore?.label)
    }
  }
  for (const m of validModels) {
    const modelName = String(m.name || '').trim()
    const firstExplore = modelName ? (m.explores || []).find((e) => !e?.hidden && String(e?.name || '').trim()) : undefined
    if (firstExplore) return mkTarget(modelName, String(firstExplore.name || '').trim(), m.label, firstExplore.label)
  }
  return null
}

const unwrapSdk = async <T>(sdk: { ok?: <U>(p: Promise<U> | U) => Promise<U> } | null | undefined, p: Promise<T> | T): Promise<T> =>
  typeof sdk?.ok === 'function' ? sdk.ok(Promise.resolve(p)) : p

export async function discoverStarterContentSummaries(sdk?: Looker40SDK | null): Promise<StarterContentSummaryItem[]> {
  if (starterContentSummariesCache) return starterContentSummariesCache
  const sdkAny = sdk as unknown as { ok?: <T>(p: Promise<T> | T) => Promise<T>; content_summary?: (req: IRequestContentSummary) => Promise<IContentSummary[]> } | null | undefined
  if (!sdkAny || typeof sdkAny.content_summary !== 'function') return []
  try {
    const rows = await unwrapSdk(sdkAny, sdkAny.content_summary.call(sdk, { limit: 6, fields: 'id,content_type,content_id,content_slug,title,description,view_count,favorite_count,is_scheduled' }))
    const normalized = (Array.isArray(rows) ? rows : [])
      .filter((r) => r && typeof r.title === 'string' && r.title.trim())
      .slice(0, 6)
      .map((r) => ({
        id: r.id, content_type: r.content_type || 'dashboard', content_id: r.content_id || r.id || null,
        content_slug: r.content_slug || null, title: String(r.title).trim(), description: r.description || null,
        view_count: typeof r.view_count === 'number' ? r.view_count : null,
        favorite_count: typeof r.favorite_count === 'number' ? r.favorite_count : null,
        is_scheduled: Boolean(r.is_scheduled),
      }))
    starterContentSummariesCache = normalized
    return normalized
  } catch {
    return []
  }
}

export async function discoverStarterExploreContext(params: {
  sdk?: Looker40SDK | null; selectedExplores?: string[]; availableModels?: LookmlModelExploreSummaryLike[]
}): Promise<StarterExploreContext | null> {
  const { sdk, selectedExplores, availableModels } = params
  let modelsList = Array.isArray(availableModels) ? availableModels : []
  let target = resolveTargetExploreFromModels(selectedExplores, modelsList)
  const sdkAny = sdk as unknown as {
    ok?: <T>(p: Promise<T> | T) => Promise<T>
    all_lookml_models?: (req?: Record<string, unknown>) => Promise<LookmlModelExploreSummaryLike[]>
    lookml_model_explore?: (...args: unknown[]) => Promise<unknown>
  } | null | undefined

  if (!target && sdkAny && typeof sdkAny.all_lookml_models === 'function') {
    try {
      const fetched = await unwrapSdk(sdkAny, sdkAny.all_lookml_models({ fields: 'name,label,project_name,explores(name,label,description,hidden)' }))
      if (Array.isArray(fetched) && fetched.length > 0) {
        modelsList = fetched
        target = resolveTargetExploreFromModels(selectedExplores, modelsList)
      }
    } catch { /* ignore */ }
  }

  const contentSummaries = await discoverStarterContentSummaries(sdk)
  if (!target) {
    return contentSummaries.length > 0
      ? { exploreKey: '', modelName: '', modelLabel: '', exploreName: '', exploreLabel: '', dimensions: [], measures: [], contentSummaries }
      : null
  }
  const cached = starterExploreContextCache.get(target.exploreKey)
  if (cached) return contentSummaries.length > 0 && !cached.contentSummaries?.length ? { ...cached, contentSummaries } : cached

  let rawExplore: Record<string, unknown> | null = null
  if (sdkAny && typeof sdkAny.lookml_model_explore === 'function') {
    try {
      const fn = sdkAny.lookml_model_explore
      rawExplore = (await unwrapSdk(
        sdkAny,
        fn.length >= 2
          ? fn.call(sdk, target.modelName, target.exploreName)
          : fn.call(sdk, {
              lookml_model_name: target.modelName, explore_name: target.exploreName,
              fields: 'name,label,model_name,fields(dimensions(name,label,label_short,type,hidden),measures(name,label,label_short,type,hidden))',
            })
      )) as Record<string, unknown>
    } catch { rawExplore = null }
  }
  if (!rawExplore && sdk && typeof LkrCodeMode?.runPythonCode === 'function') {
    try {
      const cmOut = await LkrCodeMode.runPythonCode({
        code: 'return lookml_model_explore(target_model, target_explore)', sdk,
        vars: { target_model: target.modelName, target_explore: target.exploreName },
      })
      const parsed = typeof cmOut === 'string' ? JSON.parse(cmOut) : cmOut
      if (parsed && typeof parsed === 'object') rawExplore = parsed as Record<string, unknown>
    } catch { rawExplore = null }
  }

  const rawFields = rawExplore?.fields && typeof rawExplore.fields === 'object'
    ? (rawExplore.fields as { dimensions?: Array<Record<string, unknown>>; measures?: Array<Record<string, unknown>> })
    : {}
  const normalizeFieldList = (items?: Array<Record<string, unknown>>): StarterExploreFieldSummary[] =>
    (Array.isArray(items) ? items : [])
      .filter((f) => f && !f.hidden && typeof f.name === 'string' && f.name.trim())
      .slice(0, 6)
      .map((f) => {
        const name = String(f.name).trim()
        return { name, label: String(f.label_short || f.label || humanizeLookmlIdentifier(name)).trim(), ...(f.type ? { type: String(f.type) } : {}) }
      })

  const ctx: StarterExploreContext = {
    exploreKey: target.exploreKey, modelName: target.modelName, modelLabel: target.modelLabel, exploreName: target.exploreName,
    exploreLabel: target.exploreLabel || String(rawExplore?.label || humanizeLookmlIdentifier(target.exploreName)),
    dimensions: normalizeFieldList(rawFields.dimensions), measures: normalizeFieldList(rawFields.measures),
    ...(contentSummaries.length > 0 ? { contentSummaries } : {}),
  }
  starterExploreContextCache.set(target.exploreKey, ctx)
  return ctx
}

export function buildDynamicStarterPrompts(options: BuildDynamicStarterPromptsOptions = {}): StarterPromptItem[] {
  const baseTarget = options.exploreContext?.exploreName ? options.exploreContext : resolveTargetExploreFromModels(options.selectedExplores, options.availableModels)
  const resolvedTarget = baseTarget ? { dimensions: [] as StarterExploreFieldSummary[], measures: [] as StarterExploreFieldSummary[], ...baseTarget } : null

  const hasExplore = Boolean(resolvedTarget?.exploreName)
  const expName = resolvedTarget?.exploreName || ''
  const expKey = resolvedTarget?.modelName && expName ? `${resolvedTarget.modelName}::${expName}` : expName
  const expLabel = resolvedTarget?.exploreLabel || humanizeLookmlIdentifier(expName) || 'Primary Explore'
  const modelName = resolvedTarget?.modelName || ''

  const measures = resolvedTarget?.measures || []
  const dimensions = resolvedTarget?.dimensions || []
  const [m1, m2] = measures
  const measureLabelPair = m1 && m2
    ? `${m1.label || humanizeLookmlIdentifier(m1.name)} and ${m2.label || humanizeLookmlIdentifier(m1.name)}`
    : m1 ? m1.label || humanizeLookmlIdentifier(m1.name) : 'headline KPIs and performance metrics'
  const timeDim = dimensions.find((d) => /date|time|month|week|year|quarter/i.test(`${d.type || ''} ${d.name}`)) || dimensions[0]
  const catDim =
    dimensions.find((d) => d !== timeDim && !/\b(?:id|pk)\b/i.test(d.name) && (!d.type || /string|tier|zipcode|yesno/i.test(d.type))) ||
    dimensions.find((d) => d !== timeDim) || dimensions[0]
  const timeLabel = timeDim ? timeDim.label || humanizeLookmlIdentifier(timeDim.name) : 'time-series'
  const catLabel = catDim ? catDim.label || humanizeLookmlIdentifier(catDim.name) : 'segment'

  const contentSummaries = options.contentSummaries || options.exploreContext?.contentSummaries || []
  const topContent =
    contentSummaries.find((c) => String(c.content_type || '').toLowerCase() === 'dashboard' && String(c.title || '').trim()) ||
    contentSummaries.find((c) => String(c.title || '').trim())
  const topContentTitle = stripStarterPromptEmojis(String(topContent?.title || '').trim())
  const topContentIdSuffix = topContent?.content_id ? ` (#${topContent.content_id})` : ''

  const mk = (id: string, label: string, prompt: string): StarterPromptItem => ({
    id, label: stripStarterPromptEmojis(label), prompt,
  })

  return [
    mk(
      'exec-app',
      topContentTitle && !hasExplore ? `Upgrade ${topContentTitle} to Data App` : hasExplore ? `Build ${expLabel} Data App` : 'Build an Executive KPI Data App',
      topContentTitle && !hasExplore
        ? `Convert our "${topContentTitle}" Looker ${topContent?.content_type || 'dashboard'}${topContentIdSuffix} into an interactive Data App with KPI scorecards and cross-filtering.`
        : hasExplore
        ? `Build an interactive Data App on ${expKey} with ${measureLabelPair} KPI scorecards, a ${timeLabel} trend chart, and a ${catLabel} filter.`
        : 'Build an interactive Executive KPI Data App with summary scorecards, a time-series trend chart, and segment filters from our primary LookML explore.'
    ),
    mk(
      'inv-doc',
      hasExplore ? `Investigate ${expLabel} Drivers` : 'Investigate Key Metric Drivers',
      hasExplore
        ? `Investigate key drivers of ${measureLabelPair} in ${expKey} across ${catLabel} using run_key_driver_analysis, LookML drill_fields (limit 500), and fixed point-in-time dates in a Google Doc narrative Data App.`
        : 'Investigate the root-cause key drivers of our primary business metric change using run_key_driver_analysis, LookML drill_fields (limit 500), and fixed point-in-time dates in a Google Doc narrative Data App.'
    ),
    mk(
      'native-udd',
      hasExplore ? `Create ${expLabel} Looker Dashboard` : 'Create a Native Looker Dashboard',
      hasExplore
        ? `Create a native Looker UDD on ${expKey} with ${measureLabelPair} KPI tiles, a breakdown chart by ${catLabel}, and an interactive ${catLabel} filter.`
        : 'Create a native Looker UDD with headline KPI scorecards, a segment breakdown column chart, and interactive dashboard filters.'
    ),
    options.canDevelopLookml === false
      ? mk(
          'ask-data',
          hasExplore ? `Analyze ${expLabel} Segments` : 'Ask a Data Question',
          hasExplore
            ? `What are the top ${catLabel} segments in ${expKey} by ${measureLabelPair}?`
            : 'What are the top 3 product or service segments by primary business performance in Q4?'
        )
      : mk(
          'lookml-measure',
          hasExplore ? `Add LookML Measures to ${expLabel}` : 'Add LookML Measures & Data Tests',
          hasExplore
            ? `Add curated KPI measures and field descriptions to ${expName} in model ${modelName || 'LookML'}, and verify SQL vs Explore parity.`
            : 'Add KPI summary measures to a LookML view refinement, curate field descriptions, and verify SQL vs Explore parity.'
        ),
  ]
}

export function parseStarterPromptsResponse(
  rawText: string,
  fallbackPrompts: StarterPromptItem[]
): StarterPromptItem[] {
  const cleanRaw = String(rawText || '').trim()
  if (!cleanRaw) return fallbackPrompts
  const tagMatch = cleanRaw.match(/<STARTER_PROMPTS>([\s\S]*?)<\/STARTER_PROMPTS>/i)
  const bracketMatch = (tagMatch ? tagMatch[1].trim() : cleanRaw).match(/\[[\s\S]*\]/)
  if (!bracketMatch) return fallbackPrompts

  try {
    const parsed = JSON.parse(bracketMatch[0])
    if (!Array.isArray(parsed)) return fallbackPrompts
    const normalized: StarterPromptItem[] = []
    for (let i = 0; i < parsed.length; i++) {
      const item = parsed[i]
      if (!item || typeof item !== 'object') continue
      const rec = item as Record<string, unknown>
      const label = stripStarterPromptEmojis(String(rec.label || '').trim())
      const prompt = String(rec.prompt || '').trim()
      if (!label || prompt.length < 10 || /search_content|lookml_model_explore|Solr/i.test(prompt)) continue
      const id = String(rec.id || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-') || `starter-${i}`
      normalized.push({ id, label, prompt })
      if (normalized.length >= 4) break
    }
    return normalized.length >= 3 ? normalized : fallbackPrompts
  } catch {
    return fallbackPrompts
  }
}

// ponytail: stateless out-of-band starter prompt synthesis — omits previous_interaction_id and passes tools: []
// while falling back to deterministic LookML explore/field prompts when unauthenticated or on error.
export async function generateDynamicStarterPrompts(params: {
  sdk?: Looker40SDK | null; extensionSDK?: AntigravityExtensionHostLike; auth?: AntigravityAuth; environmentId?: string
  selectedExplores?: string[]; canDevelopLookml?: boolean
  availableModels?: LookmlModelExploreSummaryLike[]; exploreContext?: StarterExploreContext | null
  model?: string; pollScheduleMs?: number[]
}): Promise<StarterPromptItem[]> {
  const {
    sdk, extensionSDK, auth, environmentId, selectedExplores = [], canDevelopLookml = true,
    availableModels = [], exploreContext: providedContext, model = DEFAULT_ANTIGRAVITY_MODEL, pollScheduleMs = DEFAULT_POLL_SCHEDULE_MS,
  } = params
  const exploreContext = providedContext !== undefined ? providedContext : await discoverStarterExploreContext({ sdk, selectedExplores, availableModels })
  const exploreKey = selectedExplores.length > 0 ? selectedExplores.join(',') : exploreContext?.exploreKey || 'none'
  const canCallAgent = Boolean(auth?.oauthToken?.trim() || (auth?.mode === 'apikey' && auth?.apiKey?.trim()))
  const localCacheKey = buildStarterPromptsCacheKey(exploreKey, canDevelopLookml, false)
  const agentCacheKey = buildStarterPromptsCacheKey(exploreKey, canDevelopLookml, true)

  if (canCallAgent) {
    const cachedAgent = starterPromptsCache.get(agentCacheKey)
    if (cachedAgent && cachedAgent.length > 0) return cachedAgent
  } else {
    const cachedLocal = starterPromptsCache.get(localCacheKey)
    if (cachedLocal && cachedLocal.length > 0) return cachedLocal
  }

  const fallbackPrompts = buildDynamicStarterPrompts({ selectedExplores, canDevelopLookml, availableModels, exploreContext })
  starterPromptsCache.set(localCacheKey, fallbackPrompts)
  if (!canCallAgent || !auth) return fallbackPrompts

  const inputText = [
    `${STARTER_PROMPTS_REQUEST_TAG} Synthesize 4 concise, tailored Looker Studio starter prompts as JSON wrapped in <STARTER_PROMPTS>[...]</STARTER_PROMPTS> (plain-text labels with zero emojis, no tools, no markdown outside tag).`,
    `LookML development enabled: ${canDevelopLookml ? 'yes' : 'no'}`,
    exploreContext?.exploreName ? `Target explore: ${exploreContext.exploreKey} (${exploreContext.exploreLabel})` : 'Target explore: none',
    exploreContext?.measures?.length ? `Top measures: ${exploreContext.measures.slice(0, 5).map((m) => `${m.name}${m.label ? ` (${m.label})` : ''}`).join(', ')}` : '',
    exploreContext?.dimensions?.length ? `Top dimensions: ${exploreContext.dimensions.slice(0, 5).map((d) => `${d.name}${d.label ? ` (${d.label})` : ''}`).join(', ')}` : '',
    exploreContext?.contentSummaries?.length
      ? `Recent user content (content_summary): ${exploreContext.contentSummaries.slice(0, 4).map((c) => `${c.content_type || 'dashboard'} "${c.title}"${c.content_id ? ` (#${c.content_id})` : ''}`).join(', ')}`
      : '',
  ].filter(Boolean).join('\n')

  try {
    const rawText = await runStatelessPrompt({
      extensionSDK, auth, environmentId, model, pollScheduleMs, inputText,
      systemInstruction: 'Synthesize 3-4 concise, tailored Looker Studio starter prompts as a JSON array with plain-text labels (no emojis) matching response_format.',
      responseFormat: STARTER_PROMPTS_RESPONSE_FORMAT,
    })
    const parsed = parseStarterPromptsResponse(rawText, fallbackPrompts)
    starterPromptsCache.set(agentCacheKey, parsed)
    return parsed
  } catch {
    return fallbackPrompts
  }
}

export const LOOKER_DASHBOARD_SKILL_MD = `---
name: looker-dashboard
description: Unified Looker Dashboarding skill (\`skills/looker-dashboard/SKILL.md\`) for UDDs, LookML Dashboards (\`.dashboard.lookml\`), Looks, Boards, Schedules, \`profile_fields\`, Highcharts \`advanced_vis_config\`, and \`lookml-dashboard-to-query\`.
---

# Unified Looker Dashboarding Skill (\`looker-dashboard\`)

Create, update, and validate UDDs, LookML Dashboards (\`.dashboard.lookml\`), Looks, Boards, and Schedules via \`run_looker_codemode\` or \`lkr-dev-cli\`.

## Step 1 — Field & Distribution Discovery (\`profile_fields\`)
Profile fields via \`profile_fields(model=m, view=e, fields=[...])\` (\`skills/looker-field-profiler/SKILL.md\`):
- \`profile:low_cardinality_enum\` (<= 15): Safe for \`pivots:\`, stacked series, \`looker_pie\` (\`limit: 6\`), and \`stats.top_values\` filters.
- \`profile:medium_cardinality_categorical\` (16–100): \`looker_bar\`/\`looker_grid\` (\`limit: "20"\`); **never pivot**.
- \`profile:searchable_entity_label\` (> 100): Top-N \`looker_grid\`/\`looker_bar\` (\`sorts: ["measure desc"]\`, \`limit: "25"\`); \`ui_config: {type: "advanced", display: "popover"}\`.
- \`profile:skewed_distribution\`: Pair \`average\` with \`median\` (\`APPROX_QUANTILES\`).
- \`profile:nullable\`: Add \`filters: {"view.dim": "-NULL"}\` on breakdowns.
- \`profile:has_zeros\`: Guard denominators with \`nullif(\${view.field}, 0)\`.
- \`profile:rare_or_skewed_boolean\` (< 5%): Filtered measure or rate \`single_value\` KPI.
- \`profile:spiky_year\` / \`profile:spiky_month\` / \`profile:spiky_day\`: Exclude incomplete \`stats.spikiness[grain]["trough_period"]\`.

## Step 2 — Execution Workflows, Compile Gate & Clean Chat Summary Rule
1. **Studio Code Mode (\`run_looker_codemode\`, 1 call, never \`update_session\`)**:
   - \`upsert_udd(title, folder_id, filters=[...], tiles=[...], dashboard_id=None)\`: Gates \`lookml_model_explore\` + 1-row \`run_inline_query("json_detail", ..., limit="1")\` SQL per Explore (propagating \`default_value\` across \`listen:\` + tile \`filters\` for partition pruning, with filter-error-only fallback), creates/updates UDD, deduplicates \`create_query\`, wires \`listen\`, and lays out 24-col grid.
   - \`upsert_lookml_dashboard(project_id, model, dashboard_name, title, tiles=[...], filters=[...], yaml_content=None, folder_id=None, sync_udd_id=None)\`: When \`tiles\` are passed (omitting \`yaml_content\`), gates \`lookml_model_explore\` + partition-pruned 1-row \`json_detail\` SQL and normalizes field filters to \`type: field_filter\` (always set a concrete \`default_value\` on date filters for large tables); writes \`dashboards/<slug>.dashboard.lookml\`, wires \`include:\`, gates \`validate_project(project_id)\` (\`ValueError\` on \`"fatal"\` & \`"warning"\` \`Unknown field\`), and imports/syncs into \`folder_id\`.
   - \`reflow_24col(dashboard_id, boxes)\`, \`pin_to_board(...)\`, \`schedule_dashboard(...)\`, \`emit_native_bundle(res, content_type="dashboard"|"lookml_dashboard"|"look"|"board", ...)\`.
2. **Clean Summary Rule**: **NEVER** include coordinates (\`Row 0\`, \`col\`, \`width\`, \`height\`, \`24-Column Grid\`) or vis identifiers (\`single_value\`, \`looker_area\`, \`looker_pie\`, \`looker_column\`, \`looker_bar\`, \`looker_grid\`) in chat replies; summarize tiles/filters and end with \`[Open <Dashboard Title>](/dashboards/<id>)\`.
3. **CLI**: \`lkr parse lookml-to-api --path /workspace/lookml --validate\` && \`lkr --dev tools lookml push /workspace/lookml --project-id <project_id> --file dashboards/<name>.dashboard.lookml --no-reset\`.

## Step 3 — 24-Column \`newspaper\` Layout & Native \`tabs:\`
1. **24-Column Grid (\`layout: newspaper\`, \`preferred_viewer: dashboards-next\`, \`col + width <= 24\`)**: Row 0 (\`height: 4\`): 3 (\`width: 8\`, \`col: 0, 8, 16\`) or 4 (\`width: 6\`) \`single_value\` KPIs; Row 4 (\`height: 8\`): 2 (\`width: 12\`) trend charts (\`looker_line\`, \`looker_area\`, \`looker_column\`); Row 12 (\`height: 8\`): breakdowns (\`looker_bar\`, \`looker_pie\`, \`looker_funnel\`, \`looker_google_map\`); Row 20 (\`height: 8\`): \`col: 0, width: 24\` \`looker_grid\` (\`table_theme: modern\`).
2. **Native Tabs (\`tabs:\` + \`tab_name:\`)**: Group multi-topic or $> 25$-tile dashboards into 2–4 root \`tabs: [{name, label}]\`; forbid HTML nav bars in \`type: text\` tiles.

## Step 4 — Four Canonical Archetypes (\`get_lookml_dashboard_examples\`)
1. **Executive Pulse (\`business_pulse\`)**: 4 PoP \`single_value\` KPIs + \`looker_area\` & \`looker_pie\` + \`looker_column\` & \`looker_google_map\` + \`looker_grid\`.
2. **Entity Deep-Dive (\`brand_lookup\`)**: Entity filter + scorecards, affinity bars, map, leaderboard.
3. **360° Inspector (\`customer_lookup\`)**: \`looker_single_record\` (\`show_null_labels: false\`) + KPIs + chronological \`looker_grid\`.
4. **Funnel (\`web_analytics_overview\`)**: \`looker_funnel\` + conversion trends + attribution grid.

## Step 5 — Visualization Matrix & Query Shape Rules (All 22 Types)
- **\`single_value\`**: 1 date dim + 1 measure (\`sorts: [date desc]\`, \`limit: 2\`, \`show_comparison: true\`, \`comparison_type: change_percentage\`) or 2 measures (\`comparison_reverse_colors: true\` when lower is better).
- **\`looker_grid\`**: \`table_theme: modern\`, \`show_view_names: false\`, \`size_to_fit: true\`, \`enable_conditional_formatting: true\`, \`series_cell_visualizations\`.
- **Cartesian Dual Y-Axes (\`looker_line\`, \`looker_column\`, \`looker_area\`, \`looker_bar\`, \`looker_scatter\`)**: \`y_axis_combined: false\`, \`y_axis_unpinned: true\`, and \`y_axes[].series\` **MUST** be objects \`[{id: "view.m", name: "Label", axisId: "view.m"}]\`.
- **Donut (\`looker_pie\`)**: 1 dim, 1 measure, 0 pivots, \`limit: 6\`, \`show_donut: true\`, \`inner_radius: 50\`.
- **Maps & Others**: \`looker_google_map\`, \`looker_map\`, \`looker_geo_choropleth\`, \`looker_geo_coordinates\` (\`map_marker_radius_min: 3\`, \`map_marker_radius_max: 25\`); \`looker_waterfall\`, \`looker_boxplot\`, \`looker_histogram\`, \`looker_funnel\`, \`looker_timeline\`, \`looker_sankey\`, \`treemap\`, \`sunburst\`, \`looker_wordcloud\`, \`looker_bullet\`, \`looker_single_record\`, \`table\`.

## Step 6 — Highcharts \`advanced_vis_config\` Guardrails
1. **Allowed (14 Highcharts types only)**: \`looker_column\`, \`looker_bar\`, \`looker_line\`, \`looker_area\`, \`looker_scatter\`, \`looker_pie\`, \`looker_funnel\`, \`looker_timeline\`, \`looker_waterfall\`, \`looker_boxplot\`, \`looker_wordcloud\`, \`looker_histogram\`, \`looker_bullet\`, \`looker_sankey\` (never \`single_value\`, \`looker_grid\`, \`table\`, \`looker_single_record\`, or maps).
2. **JSON & Security**: \`defaults_version: 1\`, valid JSON, zero JS \`formatter\` functions (use \`format\` strings like \`"{point.y:,.0f}"\`), \`borderRadius: 8\`, \`"backgroundColor": "rgba(0, 0, 0, 0)"\`.

## Step 7 — YAML Safety, Medallion Field Scoping & Self-Healing (\`lookml-dashboard-to-query\`)
1. **YAML & Filters**: Quote strings; \`snake_case\` \`name:\` without periods; \`crossfilter_enabled: true\`; use \`type: field_filter\` whenever \`model\`/\`explore\`/\`field\` is set (reserve \`type: date_filter\`/\`number_filter\`/\`string_filter\` for fieldless filters without \`model\`/\`explore\`/\`field\`/\`allow_multiple_values\`); omit \`access_filter\` duplicates.
2. **Medallion Scoping**: Keep \`bronze/<fact>.refinement.lkml\` **single-table** (cross-view fields in \`silver/\`), and **never** set \`fields: [ALL_FIELDS*, -...]\` exclusions on \`<fact>_base\` when extended by Silver.
3. **Self-Healing (\`lookml-dashboard-to-query\`)**: Verify tile SQL via \`run_inline_query("sql", body)\`, add missing fields to \`bronze/\` or \`silver/\`, re-run \`validate_project\`, and \`sync_lookml_dashboard\`.
`

export const LOOKER_FIELD_PROFILER_SKILL_MD = `---
name: looker-field-profiler
description: >
  Profile Looker Explore fields (\`string\`, \`number\`, \`yesno\`, \`datetime\`) using \`profile_fields\` in
  \`lkr code-mode sandbox\` or \`ExtendedLooker40SDK\`. Computes \`APPROX_COUNT_DISTINCT\` & \`APPROX_QUANTILES\`
  (\`limit=5000\`, \`total=True\`), expands date/time grains for temporal spikiness, walks measure leaf
  dimensions, and emits \`profile:*\` \`suggested_tags\`, \`decisions\`, and \`curation.lookml_snippet\`.
---

# Looker Field Value Profiler (\`looker-field-profiler\`)

\`profile_fields\` is pre-bound as a global in \`run_looker_codemode\` / \`lkr code-mode sandbox\` (no imports or \`sdk.\` prefix) and profiles Explore dimensions and measures within Looker's \`5000\`-row cap (\`limit="5000"\`, \`total=True\`).

## 1. Signature & Invocation

\`\`\`python
profile_fields(
    body=None, model=None, view=None, fields=None, filters=None,
    types_only=False,   # Metadata-only bucketing (0 SQL queries)
    group_fields=False, # 1 combined query for non-datetime fields -> grouped_rows
    limit=5000,
)
\`\`\`

- **Measures & \`dimension_group\`s**: Passing a measure evaluates its scalar total in \`"measures"\` and profiles its leaf \`\${...}\` dimensions; bare \`dimension_group\` names resolve to \`_date\`/\`_time\`.
- **Return dict**: \`type_buckets\` (\`string\`/\`number\`/\`yesno\`/\`datetime\`), \`profiles[field]\` (\`root_type\`, \`subtype\`, \`total_rows\`, \`approx_count_distinct\`, \`null_count\`, \`null_pct\`, \`stats\` with \`top_values\` / \`spikiness\` / \`subtotals_by_grain\`, \`suggested_tags\`, \`decisions\`, \`curation\` with \`recommended_hidden\`, \`recommended_suggestable\`, \`recommended_description\`, \`lookml_snippet\`), \`measures\`, and \`grouped_rows\`.

## 2. Subtypes & \`profile:*\` Tags

- **Cross-type**: \`profile:foreign_key\` (non-PK \`*_id\`/\`*_fk\`), \`profile:nullable\` (\`null_count > 0\`), \`profile:unique_key_candidate\` (\`approx_count_distinct == total_rows\`, \`null_count == 0\`).
- **\`string\` (first match wins)**:
  1. \`tier\`/\`location\` -> \`profile:tier\` (\`suggestable: yes\`) / \`profile:location\` (\`suggestable: no\`).
  2. \`json\` -> \`profile:json_payload\` (\`hidden: yes\`, \`suggestable: no\`).
  3. \`id_or_code\` (UUID/hash) -> \`profile:uuid_or_hash\` (\`hidden: yes\`, \`suggestable: no\`).
  4. \`id_or_code\` (PK, \`_fivetran_*\`/\`_airbyte_*\`/\`_sdc_*\`/\`etl_*\`, or \`*_id\` > 100 distinct) -> \`hidden: yes\`, \`suggestable: no\`.
  5. \`empty_or_null\` -> \`profile:empty_or_null_only\` (\`hidden: yes\`, \`suggestable: no\`).
  6. \`free_text\` (\`max_length > 120\` / \`avg_length > 60\` / notes) -> \`profile:opaque_code_or_free_text\` (\`hidden: no\`, \`suggestable: no\`).
  7. \`id_or_code\` (\`sku\`/\`code\`/\`zip\`/\`email\`/\`phone\`/\`url\`/\`ip\`/\`token\`) -> \`profile:opaque_code_or_free_text\` (\`hidden: no\`, \`suggestable: no\`).
  8. \`enum\` ($1..15$) -> \`profile:low_cardinality_enum\` (\`suggestable: yes\`).
  9. \`categorical\` ($16..100$) -> \`profile:medium_cardinality_categorical\` (\`suggestable: yes\`).
  10. \`entity_label\` ($> 100$) -> \`profile:searchable_entity_label\` (\`suggestable: yes\`).
  - PII: \`profile:pii\` + \`profile:email\` / \`profile:phone\` (or SSN/tax/name/address/IP tokens).
- **\`number\`**: \`empty_or_null\` (\`profile:empty_or_null_only\`, \`hidden: yes\`), \`id_or_key\` (\`hidden: yes\`), \`constant\` (\`profile:constant_value\`), \`duration\` (\`profile:duration\`), \`percentage_or_ratio\` (\`profile:percentage_or_ratio\`), \`currency_or_decimal\` (\`profile:currency_or_decimal\`), \`discrete_integer\` (\`profile:discrete_integer\`), \`continuous_number\` (\`profile:continuous_number\`); plus \`profile:has_zeros\`, \`profile:has_negatives\`, \`profile:skewed_distribution\` ($|\\text{avg}-\\text{median}|/|\\text{median}| \\ge 0.5$ via \`APPROX_QUANTILES\`).
- **\`yesno\`**: \`empty_or_null\` (\`hidden: yes\`), \`constant_boolean\` (\`profile:constant_boolean\`), \`rare_or_skewed_boolean\` (\`min_pct < 5%\`, \`profile:rare_or_skewed_boolean\`), \`balanced_boolean\` (\`profile:balanced_boolean\`).
- **\`datetime\` & Spikiness (\`stats.spikiness[grain]\`)**: \`timestamp_or_raw\` (\`[date, hour]\`), \`calendar_date\` / \`period_grain\` (\`[year, month, date]\`), \`calendar_cycle\`. Emits \`profile:spiky_year\` / \`profile:spiky_month\` / \`profile:spiky_day\` / \`profile:spiky_hour\` when \`spikiness_ratio >= 2.0\` or \`cv >= 0.5\`, and \`profile:steady_volume\` when \`0 < cv < 0.25\`.

## 3. Action Playbook

- **LookML Refinements (\`bronze/:table.refinement.lkml\`)**: Paste \`curation["lookml_snippet"]\` into \`view: +:table\` (never edit \`bronze/:table.view.lkml\`); hide \`json_payload\`/\`uuid_or_hash\`/\`empty_or_null_only\`/surrogate keys; set \`suggestable: no\` on \`profile:opaque_code_or_free_text\`; guard \`profile:pii\` with \`required_access_grants:\` & \`lkr parse lookml snapshot\`; assert \`profile:unique_key_candidate\` in \`.test.lkml\`.
- **Charts & Filters**: \`profile:low_cardinality_enum\` -> safe for \`pivots:\`, donuts (\`limit: 6\`), and \`stats.top_values\` filters; \`profile:medium_cardinality_categorical\` -> unpivoted bars/grids (\`limit: "20"\`); \`profile:searchable_entity_label\` -> top-N leaderboards (\`limit: "25"\`); \`profile:skewed_distribution\` -> pair \`average\` with \`median\`; \`profile:has_zeros\` -> \`nullif(\${field}, 0)\`; \`profile:nullable\` -> \`-NULL\` on breakdowns; \`profile:rare_or_skewed_boolean\` -> filtered measure/rate KPI; \`profile:spiky_*\` -> exclude incomplete \`trough_period\` and run \`run_key_driver_analysis\` on \`peak_period\`.

## 4. Sub-Skill — Scratch Schema Value Search (\`sub-skills/scratch-search/SKILL.md\`)

- **Build (\`scripts/scratch_search.py\`)**: Profiles searchable string dims (excluding PII/JSON/UUID/empty), compiles SQL branches across BigQuery/Snowflake/Postgres/Databricks/DuckDB (\`scripts/dialects/*.py\`), and writes \`view: _field_value_search_<model>\` + \`explore: _field_value_search_<model> { hidden: yes }\`.
- **Query (\`run_inline_query\`)**: Query \`_field_value_search_<model>\` with \`filters: {"_field_value_search_<model>.field_value": "%<term>%"}\` (\`limit: "20"\`) to resolve unknown or misspelled literals to exact \`(explore_name, field_name, field_value)\` tuples in one indexed lookup.
`

export const LOOKER_ALERTS_SKILL_MD = `---
name: looker-alerts
description: Triage, inspect, create, update, move, and manage Looker alerts using search_alerts, alert_details, get_alert, create_alert, update_alert, update_alert_field, delete_alert, enqueue_alert, follow_alert, unfollow_alert, alert_notifications, and read_alert_notification in lkr code-mode. Emit <ALERT_BUNDLE> when creating, editing, or inspecting a specific alert.
---

# Looker Alerts (\`skills/looker-alerts/SKILL.md\`)

Use this skill whenever the user asks about Looker alerts — troubleshooting failing alerts, verifying alert data/filters, tuning noisy alert frequencies or thresholds, diagnosing missing mobile/Slack/email notifications, moving alerts to a new dashboard tile, or creating and editing alerts in **Ripper**.

Execute Looker SDK calls via \`run_looker_codemode\`.

## 1. User-Goal Playbooks (What Users Need to Do First)

1. **"My alerts are failing — how can I disable them?"**:
   - Discover active/failing alerts via \`search_alerts(disabled=False)\` (or \`search_alerts()\` to include auto-disabled alerts).
   - Batch-inspect execution history via \`alert_details(alert_ids=[...])\` (up to 50 IDs per batch; **never** pass \`alert_ids=[]\`). Inspect \`error\`, \`disabled_reason\`, and \`alert_history_items\` (\`outcome\`, \`message\`, \`Check_start_time\`).
   - Disable quickly via \`update_alert_field(alert_id=id, body={"is_disabled": True, "disabled_reason": "Disabled by owner while fixing broken field"})\`, or repair fields/filters via \`get_alert\` -> merge -> \`update_alert\`. Emit \`<ALERT_BUNDLE>\`.
2. **"I don't think my alert data is right"**:
   - Inspect \`get_alert(alert_id=id)\` and \`alert_details(alert_ids=[id])\`.
   - Audit \`field.name\`, \`field.filter\`, \`applied_dashboard_filters\` (\`filter_title\`, \`field_name\`, \`filter_value\`), \`comparison_type\`, and \`threshold\`.
   - Update \`applied_dashboard_filters\` or \`threshold\` via \`get_alert\` -> merge -> \`update_alert\` and emit \`<ALERT_BUNDLE>\` so the user can click **Preview Dashboard with Filters** in the **Alert Inspector** tab.
3. **"I have too many alerts"**:
   - Inventory via \`search_alerts(disabled=False)\` + \`alert_details(alert_ids=[...])\` and rank by \`cron\` frequency and trigger count in \`alert_history_items\`.
   - Pick the least-destructive action: \`unfollow_alert(alert_id=id)\` (if following another owner's alert), tune \`cron\` / \`threshold\` via \`get_alert\` -> merge -> \`update_alert\`, pause via \`update_alert_field(alert_id=id, body={"is_disabled": True})\`, or mark notifications read via \`alert_notifications()\` + \`read_alert_notification(notification_id=nid)\`. Only call \`delete_alert(alert_id=id)\` when the user explicitly confirms deletion.
4. **"I'm not getting my alerts on mobile"**:
   - Inspect \`get_alert(alert_id=id)\`, \`alert_details(alert_ids=[id])\`, and \`alert_notifications()\`.
   - Verify \`is_disabled\` is \`False\`, \`destinations\` includes the expected \`destination_type\` (\`EMAIL\` or \`ACTION_HUB_INTEGRATION\`), and the user is following (\`follow_alert(alert_id=id)\`) or owns the alert.
   - Trigger an immediate test evaluation via \`enqueue_alert(alert_id=id)\` and emit \`<ALERT_BUNDLE>\`.
5. **Move an alert to a new dashboard tile (clone-and-retire)**:
   - Read the source alert with \`get_alert(alert_id=old_id)\`, call \`create_alert(body={...})\` targeting the new \`dashboard_element_id\` **first**, verify the returned \`new_alert["id"]\` is non-empty, and **only then** disable (\`update_alert_field\`) or delete (\`delete_alert\`) the old alert. Emit \`<ALERT_BUNDLE>\` for the new alert.

## 2. SDK Invariants & RBAC Boundaries (\`0.0.69+\`)

- **\`alert_details(alert_ids=[...])\` requires non-empty \`alert_ids\`**: Never call \`alert_details(alert_ids=[])\` (HTTP 400). Chunk IDs from \`search_alerts()\` in batches of \`<= 50\`.
- **Read-Modify-Write for \`update_alert\` (\`PUT /alerts/{id}\`)**: \`update_alert\` requires all 6 mandatory fields (\`comparison_type\`, \`cron\`, \`destinations\`, \`field\`, \`owner_id\`, \`threshold\`). Always call \`get_alert(alert_id=id)\` first, merge updates into the full payload, and pass to \`update_alert(alert_id=id, body=payload)\`. For \`owner_id\`, \`is_disabled\`, or \`disabled_reason\` only, use \`update_alert_field(alert_id=id, body={...})\` (\`PATCH /alerts/{id}\`).
- **RBAC**: \`create_alerts\` (own alerts), \`follow_alerts\` (\`follow_alert\`/\`unfollow_alert\`), \`manage_alerts\` (\`all_owners=True\` or modifying another user's alert).

## 3. \`<ALERT_BUNDLE>\` Right-Pane Contract

- For list-only summary questions, reply in markdown chat without emitting \`<ALERT_BUNDLE>\`.
- When creating, editing, or inspecting a specific alert, emit \`<ALERT_BUNDLE>{...}</ALERT_BUNDLE>\` with \`id\`, \`alert_id\`, \`title\`, \`custom_title\`, \`description\`, \`dashboard_id\`, \`dashboard_name\`, \`dashboard_element_id\`, \`owner_id\`, \`owner_display_name\`, \`cron\`, \`comparison_type\`, \`threshold\`, \`field\`, \`applied_dashboard_filters\`, \`destinations\`, \`is_disabled\`, \`disabled_reason\`, \`is_public\`, \`followed\`, \`followable\`, \`error\`, and \`alert_history_items\` (capped at \`<= 10\` items).
`

