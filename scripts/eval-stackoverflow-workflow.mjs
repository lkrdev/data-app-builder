#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import {
  createLiveLookerSdk,
  extractUddId,
  getApiKey,
  getArgolisAuth,
  persistedLookmlFiles,
  validateBundleOfflineWithLkrParse,
} from './eval-new-project.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)

const {
  DEFAULT_THINKING_LEVEL,
  extractSlashSkillIds,
  fetchConversationSandboxDebugMarkdown,
  runAntigravityTurn,
} = require(path.join(rootDir, 'src/antigravity.ts'))
const {
  discoverAccessibleConnections,
  extractResolvedUseCase,
  matchExplicitUseCaseRule,
} = require(path.join(rootDir, 'src/lookerApi.ts'))

const STACKOVERFLOW_SQL = `-- Description: Cumulative view_count summed across every question ever posted on Stack Overflow.
-- Business Prompt: Total Question Eyeball Count measures the total cumulative page views recorded across all Stack Overflow questions. Community leaders track this figure as the top-line indicator of overall developer reach and archive traffic.
SELECT SUM(view_count) AS total_question_views FROM \`bigquery-public-data.stackoverflow.posts_questions\`;

-- Description: Total count of posted answers, cumulative answer score, and mean answer score across all answers.
-- Business Prompt: Total Answer Ink Output and Mean Score tracks the overall volume of answers contributed along with total and average community vote scores. Knowledge managers review this to gauge aggregate answer supply and baseline quality.
SELECT COUNT(*) AS total_answers, SUM(score) AS total_answer_score, ROUND(AVG(score), 2) AS avg_answer_score FROM \`bigquery-public-data.stackoverflow.posts_answers\`;

-- Description: Date-pruned 2022 question count paired with APPROX_COUNT_DISTINCT of asking user IDs.
-- Business Prompt: Active Askers and Question Volume counts total questions posted in 2022 alongside an approximate count of distinct participating askers. Growth teams rely on this metric for rapid year-to-date contributor reach reporting.
SELECT COUNT(*) AS questions_2022, APPROX_COUNT_DISTINCT(owner_user_id) AS approx_active_askers, ROUND(SAFE_DIVIDE(COUNT(*), APPROX_COUNT_DISTINCT(owner_user_id)), 2) AS questions_per_asker FROM \`bigquery-public-data.stackoverflow.posts_questions\` WHERE DATE(creation_date) >= '2022-01-01';

-- Description: Aggregate upvotes cast, downvotes cast, and positive-vote share across all user profiles.
-- Business Prompt: Karma Generosity Net Upvote Ratio sums all positive and negative votes cast by community members and calculates the positive vote share. Community culture teams use this ratio to monitor whether voting behavior is trending constructive or punitive.
SELECT SUM(up_votes) AS total_up_votes, SUM(down_votes) AS total_down_votes, ROUND(SAFE_DIVIDE(SUM(up_votes), SUM(up_votes) + SUM(down_votes)), 4) AS upvote_generosity_ratio FROM \`bigquery-public-data.stackoverflow.users\`;

-- Description: Count and percentage share of questions that received zero answers (answer_count = 0).
-- Business Prompt: Zero-Answer Tumbleweed Limbo Rate measures how many questions sit completely unanswered and what share of all questions they represent. Community health teams watch this rate to spot underserved technical topics.
SELECT COUNT(*) AS total_questions, COUNTIF(answer_count = 0) AS tumbleweed_questions, ROUND(SAFE_DIVIDE(COUNTIF(answer_count = 0), COUNT(*)), 4) AS tumbleweed_rate FROM \`bigquery-public-data.stackoverflow.posts_questions\`;

-- Description: Share of questions where the original asker marked an accepted answer (accepted_answer_id IS NOT NULL).
-- Business Prompt: Accepted Answer Victory Rate tracks the count and percentage of questions that achieved an accepted solution from the original asker. Product teams monitor this metric as the primary signal of problem resolution success.
SELECT COUNT(*) AS total_questions, COUNTIF(accepted_answer_id IS NOT NULL) AS accepted_questions, ROUND(SAFE_DIVIDE(COUNTIF(accepted_answer_id IS NOT NULL), COUNT(*)), 4) AS accepted_victory_rate FROM \`bigquery-public-data.stackoverflow.posts_questions\`;

-- Description: Compares duplicate closure links (link_type_id = 3) against general related links (link_type_id = 1) in post_links.
-- Business Prompt: Duplicate Takedown versus Linked Citation Ratio measures how many cross-post references are duplicate closures compared with helpful related links. Moderation teams monitor this ratio to track redundant question pressure across the knowledge base.
SELECT COUNT(*) AS total_links, COUNTIF(link_type_id = 3) AS duplicate_links, COUNTIF(link_type_id = 1) AS related_links, ROUND(SAFE_DIVIDE(COUNTIF(link_type_id = 3), COUNT(*)), 4) AS duplicate_link_share FROM \`bigquery-public-data.stackoverflow.post_links\`;

-- Description: Date-pruned 2022 vote ledger computing upvote share, downvote share, and approximate distinct voted posts.
-- Business Prompt: Crowd Sentiment Score tracks upvotes versus downvotes cast in 2022 alongside the approximate number of distinct posts receiving votes. Community operations leads use this to track net voting positivity across recent content.
SELECT COUNT(*) AS total_votes_2022, COUNTIF(vote_type_id = 2) AS upvotes_2022, COUNTIF(vote_type_id = 3) AS downvotes_2022, APPROX_COUNT_DISTINCT(post_id) AS approx_voted_posts, ROUND(SAFE_DIVIDE(COUNTIF(vote_type_id = 2), COUNTIF(vote_type_id IN (2, 3))), 4) AS upvote_sentiment_share FROM \`bigquery-public-data.stackoverflow.votes\` WHERE DATE(creation_date) >= '2022-01-01';

-- Description: Compares rare Gold badge awards (class = 1) against common Bronze badges (class = 3) and tag-specialist awards.
-- Business Prompt: Gold-to-Bronze Badge Prestige Ratio compares the volume of elite gold awards against entry-level bronze awards along with specialty tag-based recognitions. Gamification analysts track this ratio to keep achievement tiers meaningful and balanced.
SELECT COUNT(*) AS total_badges, COUNTIF(class = 1) AS gold_badges, COUNTIF(class = 3) AS bronze_badges, COUNTIF(tag_based) AS tag_specialist_badges, ROUND(SAFE_DIVIDE(COUNTIF(class = 1), COUNTIF(class = 3)), 4) AS gold_to_bronze_ratio FROM \`bigquery-public-data.stackoverflow.badges\`;

-- Description: Joins 2022 answers to users to measure average answerer reputation and score yield per answer.
-- Business Prompt: Answerer Reputation Yield measures the average lifetime reputation of members posting answers in 2022 alongside the average score earned per answer. Community program managers use this to assess veteran participation in recent threads.
SELECT COUNT(a.id) AS answers_2022, ROUND(AVG(u.reputation), 1) AS avg_answerer_reputation, ROUND(SAFE_DIVIDE(SUM(a.score), COUNT(a.id)), 3) AS score_per_answer FROM \`bigquery-public-data.stackoverflow.posts_answers\` AS a INNER JOIN \`bigquery-public-data.stackoverflow.users\` AS u ON a.owner_user_id = u.id WHERE DATE(a.creation_date) >= '2022-01-01';

-- Description: Joins 2022 comments to parent questions to measure comments per commented question and mean comment score.
-- Business Prompt: Comment Chatter Density measures total comments, distinct questions discussed, comments per discussed question, and average comment score across 2022 questions. Moderation leads use this to spot threads bogged down in back-and-forth chatter.
SELECT COUNT(c.id) AS total_comments, COUNT(DISTINCT q.id) AS discussed_questions, ROUND(SAFE_DIVIDE(COUNT(c.id), COUNT(DISTINCT q.id)), 2) AS comments_per_question, ROUND(AVG(c.score), 3) AS avg_comment_score FROM \`bigquery-public-data.stackoverflow.comments\` AS c INNER JOIN \`bigquery-public-data.stackoverflow.posts_questions\` AS q ON c.post_id = q.id WHERE DATE(q.creation_date) >= '2022-01-01' AND DATE(c.creation_date) >= '2022-01-01';

-- Description: Joins 2022 questions to their accepted answers to calculate mean and median-proxy turnaround time in minutes.
-- Business Prompt: Accepted Answer Turnaround Minutes calculates how long it takes on average from when a question is posted until its accepted answer arrives, along with the share solved within one hour. Developer advocacy teams track this responsiveness benchmark.
SELECT COUNT(q.id) AS solved_questions_2022, ROUND(AVG(TIMESTAMP_DIFF(a.creation_date, q.creation_date, MINUTE)), 1) AS avg_minutes_to_accepted, ROUND(SAFE_DIVIDE(COUNTIF(TIMESTAMP_DIFF(a.creation_date, q.creation_date, MINUTE) <= 60), COUNT(q.id)), 4) AS solved_within_1h_rate FROM \`bigquery-public-data.stackoverflow.posts_questions\` AS q INNER JOIN \`bigquery-public-data.stackoverflow.posts_answers\` AS a ON q.accepted_answer_id = a.id WHERE DATE(q.creation_date) >= '2022-01-01' AND a.creation_date >= q.creation_date;

-- Description: Splits pipe-delimited question tags via UNNEST(SPLIT(tags, '|')) to measure per-tag 2022 question volume and average views.
-- Business Prompt: Individual Tag Traffic and Volume breaks apart multi-tag questions into single topics to measure question count, average score, and average eyeballs per question across the top twenty-five technologies in 2022. Ecosystem teams use this to prioritize documentation investments.
SELECT tag_name, COUNT(*) AS question_count, ROUND(AVG(q.score), 2) AS avg_score, ROUND(AVG(q.view_count), 1) AS avg_views FROM \`bigquery-public-data.stackoverflow.posts_questions\` AS q CROSS JOIN UNNEST(SPLIT(q.tags, '|')) AS tag_name WHERE DATE(q.creation_date) >= '2022-01-01' AND tag_name != '' GROUP BY tag_name ORDER BY question_count DESC LIMIT 25;

-- Description: Wildcard query across posts_* tag wiki and excerpt tables measuring edited share and average documentation length.
-- Business Prompt: Tag Wiki Documentation Freshness checks both tag wiki bodies and tag excerpts together to measure total entries, the share revised after initial creation, and average character length. Taxonomy curators use this to spot stale or under-documented tags.
SELECT _TABLE_SUFFIX AS wiki_layer, COUNT(*) AS post_count, COUNTIF(last_edit_date > creation_date) AS edited_posts, ROUND(SAFE_DIVIDE(COUNTIF(last_edit_date > creation_date), COUNT(*)), 4) AS edited_share, ROUND(AVG(LENGTH(body)), 1) AS avg_body_chars FROM \`bigquery-public-data.stackoverflow.posts_*\` WHERE _TABLE_SUFFIX IN ('tag_wiki', 'tag_wiki_excerpt') GROUP BY wiki_layer ORDER BY post_count DESC;

-- Description: Two-stage CTE aggregating Q3 2022 post_history edit events (types 4, 5, 6) per post, then reaggregating mean edits and multi-editor share.
-- Business Prompt: Revision Churn Intensity counts substantive title, body, and tag edits per post during mid-to-late 2022 and rolls up average revisions per edited post alongside the share touched by multiple editors. Moderation leads use this to track collaborative polishing versus edit wars.
WITH post_edits AS (SELECT post_id, COUNT(*) AS edit_events, APPROX_COUNT_DISTINCT(user_id) AS distinct_editors FROM \`bigquery-public-data.stackoverflow.post_history\` WHERE DATE(creation_date) BETWEEN '2022-06-01' AND '2022-09-25' AND post_history_type_id IN (4, 5, 6) GROUP BY post_id) SELECT COUNT(*) AS edited_posts, SUM(edit_events) AS total_edits, ROUND(AVG(edit_events), 2) AS avg_edits_per_post, ROUND(SAFE_DIVIDE(COUNTIF(distinct_editors >= 2), COUNT(*)), 4) AS multi_editor_share FROM post_edits;

-- Description: UNION ALL stacking 2022 questions and answers into a unified long ledger comparing volume, score, and comment density.
-- Business Prompt: Unified Content Velocity Ledger combines 2022 questions and answers side by side to compare total post volume, cumulative score, average score, and comment density per post. Platform planners use this to verify answer supply keeps pace with incoming questions.
WITH unified_posts AS (SELECT 'Question' AS post_kind, id, score, comment_count FROM \`bigquery-public-data.stackoverflow.posts_questions\` WHERE DATE(creation_date) >= '2022-01-01' UNION ALL SELECT 'Answer' AS post_kind, id, score, comment_count FROM \`bigquery-public-data.stackoverflow.posts_answers\` WHERE DATE(creation_date) >= '2022-01-01') SELECT post_kind, COUNT(*) AS total_posts, SUM(score) AS total_score, ROUND(AVG(score), 2) AS avg_score, ROUND(AVG(comment_count), 2) AS avg_comments FROM unified_posts GROUP BY post_kind ORDER BY total_posts DESC;

-- Description: Daily 2022 Q3 question counts self-joined via BETWEEN DATE_SUB(d2.dt, INTERVAL 6 DAY) AND d2.dt (triangle inequality join).
-- Business Prompt: Rolling Seven-Day Question Velocity smooths daily posting fluctuations across the third quarter of 2022 by summing each day together with the prior six days to track rolling weekly question volume and cumulative score. Operations teams use this to spot weekly traffic anomalies.
WITH daily_q AS (SELECT DATE(creation_date) AS dt, COUNT(*) AS daily_questions, SUM(score) AS daily_score FROM \`bigquery-public-data.stackoverflow.posts_questions\` WHERE DATE(creation_date) BETWEEN '2022-07-01' AND '2022-09-25' GROUP BY 1) SELECT d2.dt, d2.daily_questions, SUM(d1.daily_questions) AS rolling_7d_questions, ROUND(AVG(d1.daily_questions), 1) AS rolling_7d_avg_daily_questions, SUM(d1.daily_score) AS rolling_7d_score FROM daily_q AS d2 INNER JOIN daily_q AS d1 ON d1.dt BETWEEN DATE_SUB(d2.dt, INTERVAL 6 DAY) AND d2.dt GROUP BY d2.dt, d2.daily_questions ORDER BY d2.dt DESC LIMIT 30;

-- Description: FULL OUTER JOIN on month_key between 2022 bounty votes (types 8, 9) and bookmark/favorite votes (type 5).
-- Business Prompt: Bounty-to-Bookmark Conviction Ratio compares how many reputation bounties were launched or awarded each month in 2022 against how many posts were bookmarked as favorites. Engagement analysts track this to see when askers escalate from passive saving to spending reputation.
WITH bounties AS (SELECT FORMAT_TIMESTAMP('%Y-%m', creation_date) AS month_key, COUNT(*) AS bounty_votes FROM \`bigquery-public-data.stackoverflow.votes\` WHERE DATE(creation_date) >= '2022-01-01' AND vote_type_id IN (8, 9) GROUP BY 1), bookmarks AS (SELECT FORMAT_TIMESTAMP('%Y-%m', creation_date) AS month_key, COUNT(*) AS bookmark_votes FROM \`bigquery-public-data.stackoverflow.votes\` WHERE DATE(creation_date) >= '2022-01-01' AND vote_type_id = 5 GROUP BY 1) SELECT COALESCE(b.month_key, f.month_key) AS month_key, COALESCE(b.bounty_votes, 0) AS bounty_votes, COALESCE(f.bookmark_votes, 0) AS bookmark_votes, ROUND(SAFE_DIVIDE(COALESCE(b.bounty_votes, 0), COALESCE(f.bookmark_votes, 0)), 4) AS bounty_to_bookmark_ratio FROM bounties AS b FULL OUTER JOIN bookmarks AS f ON b.month_key = f.month_key ORDER BY month_key DESC;

-- Description: Packs 2022 question engagement attributes into JSON via TO_JSON_STRING and extracts them via JSON_VALUE to compute score per 1,000 views.
-- Business Prompt: Engagement Efficiency per Thousand Views measures how many net vote points questions earn for every thousand page views, alongside average answers per question in 2022. Content quality analysts track this to separate genuinely helpful questions from clickbait traffic.
WITH packed AS (SELECT TO_JSON_STRING(STRUCT(id, score, view_count, answer_count)) AS payload FROM \`bigquery-public-data.stackoverflow.posts_questions\` WHERE DATE(creation_date) >= '2022-01-01' AND view_count > 0) SELECT COUNT(*) AS evaluated_questions, SUM(CAST(JSON_VALUE(payload, '$.score') AS INT64)) AS total_score, SUM(CAST(JSON_VALUE(payload, '$.view_count') AS INT64)) AS total_views, ROUND(SAFE_DIVIDE(SUM(CAST(JSON_VALUE(payload, '$.score') AS INT64)) * 1000.0, SUM(CAST(JSON_VALUE(payload, '$.view_count') AS INT64))), 3) AS score_per_1k_views FROM packed;

-- Description: Unnests 2022 question tags and self-joins on same question with t1.tag < t2.tag (triangle inequality) to measure top paired tag volume and joint score.
-- Business Prompt: Cross-Tag Co-Occurrence Synergy pairs technologies appearing together on the same 2022 questions to measure pair frequency, average combined question score, and average page views across the top twenty-five pairs. Curriculum designers use this to map multi-skill developer stacks.
WITH q_tags AS (SELECT q.id AS question_id, q.score, q.view_count, tag_name FROM \`bigquery-public-data.stackoverflow.posts_questions\` AS q CROSS JOIN UNNEST(SPLIT(q.tags, '|')) AS tag_name WHERE DATE(q.creation_date) >= '2022-01-01' AND tag_name != '') SELECT t1.tag_name AS tag_a, t2.tag_name AS tag_b, COUNT(*) AS co_occurrence_count, ROUND(AVG(t1.score), 2) AS avg_joint_score, ROUND(AVG(t1.view_count), 1) AS avg_joint_views FROM q_tags AS t1 INNER JOIN q_tags AS t2 ON t1.question_id = t2.question_id AND t1.tag_name < t2.tag_name GROUP BY tag_a, tag_b ORDER BY co_occurrence_count DESC LIMIT 25;

-- Description: Joins 2022 answers to parent questions, uses RANK() window per question, and compares score of late answers (>30d) vs prompt answers.
-- Business Prompt: Necromancer Late-Answer Score Premium compares answers posted more than thirty days after a question against prompt answers posted earlier, measuring average score and top-ranked answer win share in 2022. Community analysts use this to evaluate the value of delayed solutions.
WITH qa_ranked AS (SELECT a.id AS answer_id, a.parent_id, a.score, TIMESTAMP_DIFF(a.creation_date, q.creation_date, DAY) AS lag_days, RANK() OVER (PARTITION BY a.parent_id ORDER BY a.score DESC, a.creation_date ASC) AS ans_rank FROM \`bigquery-public-data.stackoverflow.posts_answers\` AS a INNER JOIN \`bigquery-public-data.stackoverflow.posts_questions\` AS q ON a.parent_id = q.id WHERE DATE(q.creation_date) >= '2022-01-01' AND DATE(a.creation_date) >= '2022-01-01') SELECT COUNT(*) AS total_answers, COUNTIF(lag_days > 30) AS necromancer_answers, ROUND(AVG(CASE WHEN lag_days > 30 THEN score END), 3) AS avg_necromancer_score, ROUND(AVG(CASE WHEN lag_days <= 30 THEN score END), 3) AS avg_prompt_score, ROUND(SAFE_DIVIDE(COUNTIF(lag_days > 30 AND ans_rank = 1), COUNTIF(lag_days > 30)), 4) AS necromancer_top_rank_rate FROM qa_ranked;

-- Description: Aggregates 2022 answers per user joined to users, applies PERCENT_RANK() OVER (ORDER BY reputation DESC), and computes top-decile share of answer score.
-- Business Prompt: Top-Ten-Percent Elite Answer Concentration ranks active 2022 answer contributors by lifetime reputation and measures what share of total answers and total answer score comes from the top ten percent of contributors. Community leaders watch this to guard against over-reliance on a tiny elite.
WITH answerer_stats AS (SELECT a.owner_user_id AS user_id, u.reputation, COUNT(*) AS answers_2022, SUM(a.score) AS answer_score_2022 FROM \`bigquery-public-data.stackoverflow.posts_answers\` AS a INNER JOIN \`bigquery-public-data.stackoverflow.users\` AS u ON a.owner_user_id = u.id WHERE DATE(a.creation_date) >= '2022-01-01' AND a.owner_user_id IS NOT NULL GROUP BY 1, 2), ranked_users AS (SELECT *, PERCENT_RANK() OVER (ORDER BY reputation DESC) AS rep_pct_rank FROM answerer_stats) SELECT COUNT(*) AS active_answerers, SUM(answers_2022) AS total_answers, SUM(answer_score_2022) AS total_score, ROUND(SAFE_DIVIDE(SUM(CASE WHEN rep_pct_rank <= 0.10 THEN answers_2022 END), SUM(answers_2022)), 4) AS top_10_pct_answer_share, ROUND(SAFE_DIVIDE(SUM(CASE WHEN rep_pct_rank <= 0.10 THEN answer_score_2022 END), SUM(answer_score_2022)), 4) AS top_10_pct_score_share FROM ranked_users;

-- Description: Unnests tags for 2021 and 2022 questions, uses LAG() and RANK() window functions to measure YoY growth rate.
-- Business Prompt: Tag Year-over-Year Momentum tracks annual question volume for major technologies across 2021 and 2022, calculating the year-over-year volume change and annual popularity rank. Ecosystem strategists use this to spot rising frameworks early.
WITH tag_yearly AS (SELECT EXTRACT(YEAR FROM q.creation_date) AS yr, tag_name, COUNT(*) AS q_count FROM \`bigquery-public-data.stackoverflow.posts_questions\` AS q CROSS JOIN UNNEST(SPLIT(q.tags, '|')) AS tag_name WHERE DATE(q.creation_date) BETWEEN '2021-01-01' AND '2022-09-25' AND tag_name != '' GROUP BY 1, 2 HAVING q_count >= 5000), ranked AS (SELECT yr, tag_name, q_count, LAG(q_count) OVER (PARTITION BY tag_name ORDER BY yr) AS prev_yr_count, RANK() OVER (PARTITION BY yr ORDER BY q_count DESC) AS yr_rank FROM tag_yearly) SELECT tag_name, yr, q_count, prev_yr_count, ROUND(SAFE_DIVIDE(q_count - prev_yr_count, prev_yr_count), 4) AS yoy_change_rate, yr_rank FROM ranked WHERE yr = 2022 AND prev_yr_count IS NOT NULL ORDER BY q_count DESC LIMIT 25;

-- Description: FULL OUTER JOIN on user_id between 2022 askers and 2022 answerers, reaggregating platform-wide answer-to-question ratio.
-- Business Prompt: Contributor Answer-to-Question Balance matches 2022 question authors with answer authors to measure the proportion of active members who both ask and answer alongside total answers contributed per question asked. Community stewards track this reciprocity balance.
WITH askers AS (SELECT owner_user_id AS user_id, COUNT(*) AS q_cnt, SUM(score) AS q_score FROM \`bigquery-public-data.stackoverflow.posts_questions\` WHERE DATE(creation_date) >= '2022-01-01' AND owner_user_id IS NOT NULL GROUP BY 1), answerers AS (SELECT owner_user_id AS user_id, COUNT(*) AS a_cnt, SUM(score) AS a_score FROM \`bigquery-public-data.stackoverflow.posts_answers\` WHERE DATE(creation_date) >= '2022-01-01' AND owner_user_id IS NOT NULL GROUP BY 1), combined AS (SELECT COALESCE(q.user_id, a.user_id) AS user_id, COALESCE(q.q_cnt, 0) AS q_cnt, COALESCE(a.a_cnt, 0) AS a_cnt, COALESCE(q.q_score, 0) + COALESCE(a.a_score, 0) AS net_score FROM askers AS q FULL OUTER JOIN answerers AS a ON q.user_id = a.user_id) SELECT COUNT(*) AS active_contributors, COUNTIF(q_cnt > 0 AND a_cnt > 0) AS dual_contributors, ROUND(SAFE_DIVIDE(COUNTIF(q_cnt > 0 AND a_cnt > 0), COUNT(*)), 4) AS dual_contributor_share, ROUND(SAFE_DIVIDE(SUM(a_cnt), SUM(q_cnt)), 3) AS answer_to_question_ratio FROM combined;

-- Description: Full-stack multi-CTE pipeline uniting 2022 questions, answers, comments, badges, and unnested tags across users via UNION ALL, FULL OUTER JOIN, window NTILE, and APPROX_COUNT_DISTINCT.
-- Business Prompt: Grand Unified Developer Impact Super-Index combines 2022 question asking, answer writing, comment engagement, badge awards, and technology tag breadth per member, segments active contributors into four reputation quartiles, and reports average composite impact score and top-quartile contribution share. Leadership uses this comprehensive metric for annual community health reviews.
WITH post_activity AS (SELECT owner_user_id AS user_id, 'question' AS kind, id AS post_id, score FROM \`bigquery-public-data.stackoverflow.posts_questions\` WHERE DATE(creation_date) >= '2022-01-01' AND owner_user_id IS NOT NULL UNION ALL SELECT owner_user_id AS user_id, 'answer' AS kind, id AS post_id, score FROM \`bigquery-public-data.stackoverflow.posts_answers\` WHERE DATE(creation_date) >= '2022-01-01' AND owner_user_id IS NOT NULL), user_posts AS (SELECT user_id, COUNTIF(kind = 'question') AS q_cnt, COUNTIF(kind = 'answer') AS a_cnt, SUM(score) AS post_score FROM post_activity GROUP BY 1), user_badges AS (SELECT user_id, COUNT(*) AS badge_cnt, COUNTIF(class = 1) AS gold_cnt FROM \`bigquery-public-data.stackoverflow.badges\` WHERE DATE(date) >= '2022-01-01' GROUP BY 1), user_comments AS (SELECT user_id, COUNT(*) AS comment_cnt FROM \`bigquery-public-data.stackoverflow.comments\` WHERE DATE(creation_date) >= '2022-01-01' AND user_id IS NOT NULL GROUP BY 1), user_tags AS (SELECT q.owner_user_id AS user_id, APPROX_COUNT_DISTINCT(tag_name) AS approx_tags FROM \`bigquery-public-data.stackoverflow.posts_questions\` AS q CROSS JOIN UNNEST(SPLIT(q.tags, '|')) AS tag_name WHERE DATE(q.creation_date) >= '2022-01-01' AND q.owner_user_id IS NOT NULL AND tag_name != '' GROUP BY 1), unified AS (SELECT u.id AS user_id, u.reputation, COALESCE(p.q_cnt, 0) AS q_cnt, COALESCE(p.a_cnt, 0) AS a_cnt, COALESCE(p.post_score, 0) AS post_score, COALESCE(b.badge_cnt, 0) AS badge_cnt, COALESCE(b.gold_cnt, 0) AS gold_cnt, COALESCE(c.comment_cnt, 0) AS comment_cnt, COALESCE(t.approx_tags, 0) AS approx_tags, (COALESCE(p.a_cnt, 0) * 3.0 + COALESCE(p.q_cnt, 0) * 1.0 + COALESCE(p.post_score, 0) * 2.0 + COALESCE(b.badge_cnt, 0) * 1.5 + COALESCE(c.comment_cnt, 0) * 0.25) AS impact_index FROM \`bigquery-public-data.stackoverflow.users\` AS u FULL OUTER JOIN user_posts AS p ON u.id = p.user_id LEFT JOIN user_badges AS b ON COALESCE(u.id, p.user_id) = b.user_id LEFT JOIN user_comments AS c ON COALESCE(u.id, p.user_id) = c.user_id LEFT JOIN user_tags AS t ON COALESCE(u.id, p.user_id) = t.user_id WHERE p.user_id IS NOT NULL), quartiled AS (SELECT *, NTILE(4) OVER (ORDER BY reputation DESC) AS rep_quartile FROM unified) SELECT COUNT(*) AS evaluated_members, ROUND(AVG(impact_index), 2) AS avg_impact_index, ROUND(MAX(impact_index), 2) AS peak_impact_index, ROUND(SAFE_DIVIDE(SUM(CASE WHEN rep_quartile = 1 THEN impact_index END), SUM(impact_index)), 4) AS top_quartile_impact_share FROM quartiled;`

async function main() {
  persistedLookmlFiles.clear()
  const apiKey = getApiKey()
  const argolis = getArgolisAuth()
  const sdk = createLiveLookerSdk(argolis)
  const projArgIdx = process.argv.indexOf('--project')
  const projEqArg = process.argv.find((a) => a.startsWith('--project='))?.split('=', 2)?.[1]
  const shortId = Math.random().toString(36).slice(2, 6)
  const projectName = (projEqArg || (projArgIdx >= 0 ? process.argv[projArgIdx + 1] : '') || `stackoverflow_${shortId}`).trim()
  const selectedFolderId = argolis.personal_folder_id || '5'
  const allowedModes = ['app', 'data-investigator', 'dashboard', 'conversational-analytics', 'lookml', 'health-check', 'tile']
  await discoverAccessibleConnections(sdk)

  console.log(`[eval-stackoverflow-workflow] Starting live 2-turn eval on dev-argolis (${argolis.base_url})`)
  console.log(`[eval-stackoverflow-workflow] user_id=${argolis.user_id} selectedFolderId=${selectedFolderId} projectName=${projectName}`)

  let session = { conversationId: `eval_so_${shortId}`, explores: [] }
  let environmentId
  let latestInteractionId
  let latestSteps = []
  let lookmlProjectId = ''
  let activatedLookmlSkills = []
  let nativeContent = null
  let lastResolvedUseCase = 'auto'
  const priorMessages = []

  const turns = [
    {
      turn: 1,
      name: 'Turn 1: /agentic-lookml-workflow -> read skill, generate Stack Overflow LookML & explores',
      prompt: `/agentic-lookml-workflow Here are some sql queries, get to work on a new project called ${projectName} and use bigquery default connection\n\n${STACKOVERFLOW_SQL}`,
      grade: async (res) => {
        const steps = res.activitySteps || []
        const stepsText = JSON.stringify(steps).toLowerCase()
        const slashSkills = extractSlashSkillIds(turns[0].prompt)
        const calledSkill = slashSkills.includes('agentic-lookml-workflow') && res.resolvedUseCase === 'lookml'
        const readSkill =
          steps.some((s) => s.kind === 'skill' && /agentic-lookml-workflow/i.test(`${s.title || ''} ${s.path || ''} ${s.detail || ''}`)) ||
          /agentic-lookml-workflow\/skill\.md/i.test(stepsText)

        let rawFiles = res.lookmlBundle?.files || []
        const activeProj = res.lookmlBundle?.project_id || lookmlProjectId || projectName
        if (rawFiles.length === 0) {
          try {
            await sdk.update_session({ workspace_id: 'dev' })
            const remoteMeta = (await sdk.all_project_files(activeProj)) || []
            const fetched = []
            for (const rf of remoteMeta) {
              const p = String(rf?.path || rf?.id || '').replace(/^\/+/, '')
              if (p.endsWith('.lkml') || p.endsWith('.lookml')) {
                const content = await sdk.get_file_content(activeProj, p)
                if (typeof content === 'string') fetched.push({ path: p, content })
              }
            }
            rawFiles = fetched
          } catch {}
        }

        const files = rawFiles.map((f) => f.path || f)
        const hasModel = files.some((f) => String(f).endsWith('.model.lkml'))
        const hasViews = files.some((f) => String(f).endsWith('.view.lkml') || String(f).endsWith('.refinement.lkml'))
        const exploreFiles = files.filter((f) => String(f).endsWith('.explore.lkml'))
        const hasExplores = exploreFiles.length > 0
        const offlineParse = validateBundleOfflineWithLkrParse(rawFiles)

        let liveProjectValid = false
        let liveProjectFatalErrors = []
        try {
          await sdk.update_session({ workspace_id: 'dev' })
          const valRes = await sdk.validate_project(activeProj)
          liveProjectFatalErrors = (valRes?.errors || []).filter((e) => {
            const sev = String(e?.severity || 'fatal').toLowerCase()
            return sev === 'fatal' || sev === 'error'
          })
          liveProjectValid = Array.isArray(valRes?.errors) && liveProjectFatalErrors.length === 0
        } catch (err) {
          liveProjectFatalErrors = [String(err?.message || err)]
        }

        const hasLookmlBundle = Boolean(res.lookmlBundle?.files?.length)
        return {
          passed:
            calledSkill &&
            readSkill &&
            hasLookmlBundle &&
            hasModel &&
            hasViews &&
            hasExplores &&
            offlineParse.ok &&
            liveProjectValid,
          checks: {
            calledSkill,
            readSkill,
            resolvedUseCase: res.resolvedUseCase,
            hasLookmlBundle,
            hasModel,
            hasViews,
            hasExplores,
            exploreFiles,
            fileCount: files.length,
            offlineParseOk: offlineParse.ok,
            offlineParseError: offlineParse.error,
            liveProjectValid,
            liveProjectFatalErrors: liveProjectFatalErrors.slice(0, 5),
            files,
          },
        }
      },
    },
    {
      turn: 2,
      name: 'Turn 2: Generate a quick dashboard with some of the metrics',
      prompt: 'Generate a quick dashboard with some of the metrics!',
      grade: async (res) => {
        const rawText = res.assistantText || ''
        const stepsText = JSON.stringify(res.activitySteps || []).toLowerCase()
        const resolvedDashboard = res.resolvedUseCase === 'dashboard'
        const copiedToSelectedFolder =
          /import_lookml_dashboard|sync_lookml_dashboard|create_dashboard|upsert_lookml_dashboard|upsert_udd/.test(stepsText) &&
          (stepsText.includes(`"${selectedFolderId}"`) ||
            stepsText.includes('target_folder_id') ||
            String(res.nativeBundle?.folder_id || res.nativeBundle?.folderId || '') === String(selectedFolderId))

        let liveDashExists = false
        let liveDashFolderMatches = false
        let liveDashTileCount = 0
        let liveDashTilesAllValid = false
        const liveTileErrors = []
        const rawDashId = extractUddId(res.nativeBundle)
        if (rawDashId) {
          try {
            await sdk.update_session({ workspace_id: 'dev' })
            const liveDash = await sdk.dashboard(rawDashId)
            liveDashExists = Boolean(liveDash && String(liveDash.id) === rawDashId)
            liveDashFolderMatches = String(liveDash?.folder?.id || liveDash?.space?.id || '') === String(selectedFolderId)
            const filterDefaults = Object.fromEntries(
              (liveDash?.dashboard_filters || [])
                .filter((f) => f?.name && f?.default_value)
                .map((f) => [String(f.name), String(f.default_value)])
            )
            const elements = liveDash?.dashboard_elements || []
            liveDashTileCount = elements.length
            const queryElements = elements.filter((el) => el?.type !== 'text')
            if (queryElements.length >= 3) {
              await Promise.all(
                queryElements.map(async (el) => {
                  const q = el?.query || el?.result_maker?.query
                  const qFields = Array.isArray(q?.fields) ? q.fields : []
                  if (!q?.model || !q?.view || qFields.length === 0) {
                    liveTileErrors.push(`${el?.title || el?.id}: empty fields or missing query`)
                    return
                  }
                  const listenFlts = {}
                  for (const fb of el?.result_maker?.filterables || []) {
                    for (const l of fb?.listen || []) {
                      const dv = filterDefaults[String(l?.dashboard_filter_name || '')]
                      if (dv && l?.field) listenFlts[String(l.field)] = dv
                    }
                  }
                  try {
                    const rows = await sdk.run_inline_query('json', {
                      model: q.model,
                      view: q.view,
                      fields: qFields,
                      filters: { ...listenFlts, ...(q.filters || {}) },
                      sorts: q.sorts || [],
                      ...(Array.isArray(q.pivots) && q.pivots.length > 0 ? { pivots: q.pivots } : {}),
                      limit: '5',
                    })
                    if (!Array.isArray(rows) || rows[0]?.looker_error) {
                      liveTileErrors.push(`${el?.title || el?.id}: ${JSON.stringify(rows).slice(0, 180)}`)
                    }
                  } catch (qErr) {
                    liveTileErrors.push(`${el?.title || el?.id}: ${String(qErr?.message || qErr)}`)
                  }
                })
              )
              liveDashTilesAllValid = liveTileErrors.length === 0
            }
          } catch (dErr) {
            liveTileErrors.push(String(dErr?.message || dErr))
          }
        }
        const hasDashboardLink = /\/dashboards\/[^\s)]+/i.test(rawText)
        return {
          passed:
            resolvedDashboard &&
            copiedToSelectedFolder &&
            liveDashExists &&
            liveDashFolderMatches &&
            liveDashTileCount >= 3 &&
            liveDashTilesAllValid &&
            hasDashboardLink,
          checks: {
            resolvedDashboard,
            copiedToSelectedFolder,
            liveDashExists,
            liveDashFolderMatches,
            liveDashTileCount,
            liveDashTilesAllValid,
            liveTileErrors,
            hasDashboardLink,
            nativeBundle: res.nativeBundle || null,
          },
        }
      },
    },
  ]

  const report = {
    startedAt: new Date().toISOString(),
    instance: argolis.base_url,
    projectName,
    selectedFolderId,
    turns: [],
  }

  const outIdx = process.argv.indexOf('--out')
  const outPath =
    outIdx >= 0 && process.argv[outIdx + 1]
      ? path.resolve(process.argv[outIdx + 1])
      : path.join(rootDir, 'tmp/evals/stackoverflow-workflow-latest.json')

  try {
    for (const t of turns) {
      console.log(`\n=== ${t.name} ===`)
      console.log(`> User: ${t.prompt.split('\n')[0]} ...`)
      const promptSlashSkills = extractSlashSkillIds(t.prompt)
      if (promptSlashSkills.length > 0) {
        activatedLookmlSkills = Array.from(new Set([...activatedLookmlSkills, ...promptSlashSkills]))
      }
      const classified = matchExplicitUseCaseRule(t.prompt, allowedModes)
      const turnTargetUseCase = classified || 'auto'
      const toolMode =
        turnTargetUseCase === 'lookml' || (turnTargetUseCase === 'auto' && lastResolvedUseCase === 'lookml')
          ? 'lookml'
          : 'data_app'
      const mode = turnTargetUseCase === 'dashboard' ? 'dashboard' : 'data_app'
      const t0 = Date.now()
      let res
      try {
        res = await runAntigravityTurn({
          sdk,
          userId: argolis.user_id,
          environmentId,
          conversationId: session.conversationId,
          onEnvironmentUpdated: (envId) => {
            environmentId = envId
            console.log(`  [env] ${envId}`)
          },
          auth: { mode: 'apikey', apiKey },
          session,
          thinkingLevel: DEFAULT_THINKING_LEVEL,
          mode,
          useCase: 'auto',
          allowedModes,
          selectedExplores: session.explores || [],
          folderId: selectedFolderId,
          toolMode,
          lookmlProjectId,
          activatedLookmlSkills,
          developableProjects: lookmlProjectId ? [lookmlProjectId] : [],
          canDeploy: true,
          warmEnvironmentInBackground: true,
          schemaMarkdown: '',
          userPrompt: t.prompt,
          existingNativeContent: nativeContent,
          priorMessages,
          requirePermission: false,
          pollScheduleMs: [250, 450, 700, 1000],
          onInteractionCreated: (id) => {
            latestInteractionId = id
            console.log(`  [interaction] ${id}`)
          },
          onProgressSteps: (steps) => {
            latestSteps = steps
          },
          onStatus: (s) => process.stdout.write(`  [status] ${s}\n`),
        })
      } catch (err) {
        console.error(`  [error] Turn ${t.turn} threw:`, err)
        priorMessages.push({ role: 'user', text: t.prompt })
        priorMessages.push({ role: 'error', text: String(err?.stack || err) })
        report.turns.push({
          turn: t.turn,
          name: t.name,
          prompt: t.prompt,
          durationMs: Date.now() - t0,
          interactionId: latestInteractionId,
          activitySteps: latestSteps,
          error: String(err?.stack || err),
          passed: false,
        })
        break
      }

      const durationMs = Date.now() - t0
      session = { ...res.session, conversationId: session.conversationId }
      if (res.session?.environmentId) environmentId = res.session.environmentId
      if (res.lookmlBundle?.project_id) lookmlProjectId = res.lookmlBundle.project_id
      else if (!lookmlProjectId && t.turn === 1) lookmlProjectId = projectName
      if (res.nativeBundle) nativeContent = res.nativeBundle
      lastResolvedUseCase = res.resolvedUseCase || extractResolvedUseCase(res.assistantText, t.prompt, allowedModes)

      priorMessages.push({ role: 'user', text: t.prompt })
      priorMessages.push({
        role: 'assistant',
        text: res.assistantText,
        interactionId: res.session?.lastInteractionId,
        activitySteps: res.activitySteps,
      })

      const evaluation = await t.grade(res, { durationMs })
      console.log(`  [assistant (${(durationMs / 1000).toFixed(1)}s)] ${(res.assistantText || '').slice(0, 500).replace(/\n/g, ' ')}`)
      console.log(`  [grade] passed=${evaluation.passed}`, JSON.stringify(evaluation.checks))

      report.turns.push({
        turn: t.turn,
        name: t.name,
        durationMs,
        interactionId: res.session?.lastInteractionId,
        telemetry: res.telemetry,
        resolvedUseCase: lastResolvedUseCase,
        assistantText: res.assistantText,
        activitySteps: res.activitySteps,
        hasLookmlBundle: Boolean(res.lookmlBundle),
        lookmlProjectId: res.lookmlBundle?.project_id || lookmlProjectId,
        lookmlFiles: (res.lookmlBundle?.files || []).map((f) => f.path || f),
        hasNativeBundle: Boolean(res.nativeBundle),
        nativeBundle: res.nativeBundle || null,
        passed: evaluation.passed,
        checks: evaluation.checks,
      })
    }
  } finally {
    try {
      const debugMd = await fetchConversationSandboxDebugMarkdown({
        auth: { mode: 'apikey', apiKey },
        conversationId: session.conversationId,
        label: report.projectName,
        useCase: lastResolvedUseCase,
        environmentId,
        lastInteractionId: session.lastInteractionId || latestInteractionId,
        messages: priorMessages,
      })
      const mdPath = outPath.replace(/\.json$/i, '.md')
      fs.mkdirSync(path.dirname(mdPath), { recursive: true })
      fs.writeFileSync(mdPath, debugMd, 'utf8')
      console.log(`[eval-stackoverflow-workflow] Saved sandbox debug dump to ${mdPath}`)
    } catch (dumpErr) {
      console.warn('[eval-stackoverflow-workflow] Debug dump warning:', dumpErr?.message || dumpErr)
    }
    if (!process.argv.includes('--keep')) {
      const dashId = extractUddId(nativeContent)
      if (dashId && !dashId.includes('::')) {
        try {
          await sdk.delete_dashboard(dashId)
          console.log(`[eval-stackoverflow-workflow] Cleaned up UDD dashboard ${dashId}`)
        } catch {}
      }
      const projToClean = lookmlProjectId || projectName
      const modelToClean = projToClean.replace(/-/g, '_')
      if (modelToClean) {
        try {
          await sdk.delete_lookml_model(modelToClean)
          console.log(`[eval-stackoverflow-workflow] Cleaned up LookML model ${modelToClean}`)
        } catch {}
      }
      if (projToClean) {
        try {
          await sdk.delete_project(projToClean)
          console.log(`[eval-stackoverflow-workflow] Cleaned up LookML project ${projToClean}`)
        } catch {}
      }
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.log(`\n[eval-stackoverflow-workflow] Saved full report to ${outPath}`)
  const passedCount = report.turns.filter((x) => x.passed).length
  console.log(`[eval-stackoverflow-workflow] Score: ${passedCount}/${turns.length} turns passed`)
  if (passedCount < turns.length) process.exitCode = 1
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
