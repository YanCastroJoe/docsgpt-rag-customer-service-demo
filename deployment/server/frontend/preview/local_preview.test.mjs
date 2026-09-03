import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const html = readFileSync(new URL('./shared/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('./shared/app.js', import.meta.url), 'utf8');
const logic = readFileSync(new URL('./shared/rag_logic.mjs', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./shared/styles.css', import.meta.url), 'utf8');
const opsHtml = readFileSync(new URL('../ops/index.html', import.meta.url), 'utf8');
const opsScript = readFileSync(new URL('../ops/app.js', import.meta.url), 'utf8');
const nginx = readFileSync(new URL('../nginx.conf', import.meta.url), 'utf8');
const dockerfile = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');

test('shared preview behaves like a customer product surface', () => {
  assert.match(html, /售后智能助手/);
  assert.match(html, /在线咨询/);
  assert.match(html, /猜你想问/);
  assert.match(html, /href="\/ops\/">诊断台/);
  assert.match(html, /知识库已连接/);
  assert.doesNotMatch(html, /固定快照 2026-08-07/);
  assert.match(script, /查看来源/);
  assert.match(logic, /capability_scope/);
  assert.match(logic, /personal_data_unavailable/);
  assert.match(logic, /partial_answer/);
});

test('shared preview exposes real-field source details without inventing chunk data', () => {
  assert.match(html, /id="source-drawer"/);
  assert.match(logic, /customer_service_rag_optimized\.md/);
  assert.match(script, /本地静态预览未提供/);
  assert.match(script, /不适用（确定性规则预览）/);
});

test('cloud demo mode loads the shared Agent and streams real answers', () => {
  assert.match(html, /name="shared-agent-token"/);
  assert.match(script, /\/api\/shared_agent\?token=/);
  assert.match(script, /fetch\('\/stream'/);
  assert.match(script, /save_conversation: false/);
  assert.match(script, /event\.type === 'source'/);
  assert.match(script, /'type': 'thought'/);
  assert.match(script, /const effectiveSources = refusal \? \[\] : rawSources/);
  assert.match(script, /refusalReason: refusal \? 'knowledge_boundary' : null/);
  assert.match(nginx, /default_type application\/javascript/);
  assert.match(nginx, /absolute_redirect off/);
  assert.match(dockerfile, /chmod -R a\+rX/);
});

test('shared preview provides recovery, feedback and duplicate-submit protection', () => {
  assert.match(script, /补充售后情况/);
  assert.match(script, /查看可咨询问题/);
  assert.match(script, /联系人工客服/);
  assert.match(script, /答非所问/);
  assert.match(script, /仅保存在本地预览内存中/);
  assert.match(script, /if \(!question \|\| state\.busy\) return/);
  assert.match(script, /event\.key === 'Enter' && !event\.shiftKey/);
});

test('shared preview persists honest local interaction traces for ops inspection', () => {
  assert.match(script, /TRACE_STORAGE_KEY/);
  assert.match(script, /localStorage\.setItem/);
  assert.match(logic, /deterministic_local_preview/);
  assert.match(logic, /本地静态预览未调用向量库或 LLM Prompt/);
});

test('shared preview excludes portfolio and engineering narration', () => {
  const content = `${html}\n${script}`;
  assert.doesNotMatch(content, /LOCAL PREVIEW/);
  assert.doesNotMatch(content, /TRUSTED RAG EXPERIENCE/);
  assert.doesNotMatch(content, /ANSWER CHECK/);
  assert.doesNotMatch(content, /DESIGN PRINCIPLE/);
  assert.doesNotMatch(content, /评测与诊断/);
});

test('shared preview has a focused responsive chat layout', () => {
  assert.match(styles, /\.chat-card/);
  assert.match(styles, /\.conversation/);
  assert.match(styles, /\.source-drawer/);
  assert.match(styles, /@media \(max-width: 700px\)/);
});

test('local ops preview links back to the shared preview without changing cloud behavior', () => {
  assert.match(opsHtml, /id="preview-badge"/);
  assert.match(opsHtml, /id="demo-link"/);
  assert.match(opsScript, /window\.location\.hostname/);
  assert.match(opsScript, /\/preview\/shared\//);
});

test('ops preview shows regression deltas and honest missing retrieval fields', () => {
  assert.match(opsHtml, /默认基线：上一版本/);
  assert.match(opsHtml, /当前快照中的检索信息/);
  assert.match(opsScript, /deltaLabel/);
  assert.match(opsScript, /status-regression/);
  assert.match(opsScript, /历史失败明细未保存/);
  assert.match(opsScript, /当前记录未提供/);
});

test('ops preview exposes recent local interactions without calling them API traces', () => {
  assert.match(opsHtml, /data-view-target="live"/);
  assert.match(opsHtml, /最近交互诊断/);
  assert.match(opsHtml, /不是 DocsGPT 后端 API、向量检索、LLM Prompt 或生产 Trace/);
  assert.match(opsScript, /loadLocalTraces/);
  assert.match(opsScript, /规范化问题/);
  assert.match(opsScript, /子问题覆盖/);
  assert.match(opsScript, /未调用 LLM Prompt/);
});

test('ops preview renders model excerpts without injecting raw HTML', () => {
  assert.match(opsScript, /renderSafeMarkdown/);
  assert.match(opsScript, /document\.createTextNode/);
  assert.doesNotMatch(opsScript, /trace-detail'\)\.innerHTML/);
});
