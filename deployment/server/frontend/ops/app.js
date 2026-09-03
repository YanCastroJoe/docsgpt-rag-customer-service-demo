import { TRACE_STORAGE_KEY } from '../preview/shared/rag_logic.mjs?v=20260903-1';

const text = (value, fallback = '当前记录未提供') => value === null || value === undefined || value === '' ? fallback : String(value);
const rate = (value) => value === null || value === undefined ? '--' : `${Number(value).toFixed(value % 1 ? 1 : 0)}%`;
const latency = (value) => value === null || value === undefined ? '--' : `${(Number(value) / 1000).toFixed(1)} s`;
const metricKeys = ['end_to_end_pass_rate', 'condition_coverage', 'source_hit_rate', 'boundary_pass_rate'];

const createElement = (tag, className, content) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
};

function appendInlineMarkdown(parent, value) {
  const source = String(value || '');
  let cursor = 0;
  const pattern = /\*\*(.+?)\*\*/g;
  let match;
  while ((match = pattern.exec(source))) {
    parent.append(document.createTextNode(source.slice(cursor, match.index)));
    parent.append(createElement('strong', '', match[1]));
    cursor = match.index + match[0].length;
  }
  parent.append(document.createTextNode(source.slice(cursor)));
}

function renderSafeMarkdown(value) {
  const container = createElement('div', 'safe-markdown');
  let list = null;
  String(value || '未记录回答').split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed) { list = null; return; }
    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    const numbered = trimmed.match(/^\d+[.)]\s+(.+)$/);
    if (heading) {
      list = null;
      const node = createElement(`h${Math.min(heading[1].length + 2, 5)}`);
      appendInlineMarkdown(node, heading[2]);
      container.append(node);
    } else if (bullet || numbered) {
      const ordered = Boolean(numbered);
      if (!list || list.tagName !== (ordered ? 'OL' : 'UL')) {
        list = createElement(ordered ? 'ol' : 'ul');
        container.append(list);
      }
      const item = createElement('li');
      appendInlineMarkdown(item, (bullet || numbered)[1]);
      list.append(item);
    } else {
      list = null;
      const paragraph = createElement('p');
      appendInlineMarkdown(paragraph, trimmed);
      container.append(paragraph);
    }
  });
  return container;
}

function createTraceCard(label, value, options = {}) {
  const card = createElement('article', `trace-card${options.wide ? ' wide' : ''}`);
  card.append(createElement('span', '', label));
  const body = createElement('div', options.className || '');
  if (options.markdown) body.append(renderSafeMarkdown(value));
  else body.textContent = value;
  card.append(body);
  return card;
}

function renderRetrievalRecord(trace) {
  const body = document.querySelector('#retrieval-body');
  body.replaceChildren();
  const notice = document.querySelector('#retrieval-notice');
  if (!trace.sources.length) {
    notice.textContent = '该边界用例没有记录来源；页面不会生成虚假 Chunk 或引用。';
    const row = document.createElement('tr');
    const cell = createElement('td', 'empty-row', '无来源记录（知识边界拒答）');
    cell.colSpan = 6;
    row.append(cell);
    body.append(row);
    return;
  }
  notice.textContent = '当前固定快照只保存了来源文件名，未保存 Chunk ID、逐路召回方式、分数和是否进入 Prompt。';
  trace.sources.forEach((sourceName, index) => {
    const row = document.createElement('tr');
    [String(index + 1), sourceName, '当前记录未提供', '当前记录未提供', '当前记录未提供', '当前记录未提供']
      .forEach((value) => row.append(createElement('td', value === '当前记录未提供' ? 'missing-value' : '', value)));
    body.append(row);
  });
}

function renderTrace(trace) {
  const failures = trace.failure_types.length ? trace.failure_types.join('、') : '无';
  const detail = document.querySelector('#trace-detail');
  detail.replaceChildren(
    createTraceCard('01 · 用户问题', trace.question, { wide: true }),
    createTraceCard('02 · 期望行为', trace.expected_behavior === 'answer' ? '知识命中回答' : '知识边界拒答'),
    createTraceCard('03 · 规则验证', trace.overall_pass ? '通过' : `未通过：${failures}`, { className: trace.overall_pass ? 'status-pass' : 'status-fail' }),
    createTraceCard('04 · 记录来源', trace.sources.length ? trace.sources.join('、') : '未记录来源', { wide: true }),
    createTraceCard('05 · 回答摘录', trace.answer_excerpt || '未记录回答', { wide: true, markdown: true }),
    createTraceCard('06 · 条件覆盖', rate(trace.condition_coverage)),
    createTraceCard('07 · 响应耗时', latency(trace.latency_ms)),
  );
  renderRetrievalRecord(trace);
}

function loadLocalTraces() {
  try {
    const records = JSON.parse(localStorage.getItem(TRACE_STORAGE_KEY) || '[]');
    return Array.isArray(records) ? records : [];
  } catch (_) {
    return [];
  }
}

function renderLocalTrace(trace) {
  const detail = document.querySelector('#live-trace-detail');
  const coverage = trace.coverage || {};
  detail.replaceChildren(
    createTraceCard('01 · Request ID', text(trace.request_id), { wide: true }),
    createTraceCard('02 · 原始问题', text(trace.original_question), { wide: true }),
    createTraceCard('03 · 识别意图', text(trace.intent)),
    createTraceCard('04 · 规范化问题', text(trace.normalized_question), { wide: true }),
    createTraceCard('05 · 子问题覆盖', `${text(coverage.handled, 0)}/${text(coverage.total, 0)} 已处理 · ${text(coverage.status)}`),
    createTraceCard('06 · 拒答 / 部分回答原因', text(trace.refusal_reason, '无')),
    createTraceCard('07 · 最终回答', text(trace.final_answer), { wide: true, markdown: true }),
    createTraceCard('08 · 本地响应耗时', `${text(trace.duration_ms)} ms`),
  );

  const retrieval = trace.retrieval || {};
  const sources = Array.isArray(trace.sources) ? trace.sources : [];
  const subQuestions = Array.isArray(trace.sub_questions) ? trace.sub_questions : [];
  const pipeline = document.querySelector('#live-pipeline');
  pipeline.replaceChildren();
  [
    ['用户问题', text(trace.original_question)],
    ['Query Rewrite', text(trace.normalized_question)],
    ['意图识别', text(trace.intent)],
    ['子问题拆分', subQuestions.length ? subQuestions.map((item) => `${item.label}：${item.status}`).join('；') : '单一问题，无需拆分'],
    ['本地规则命中', sources.length ? sources.map((item) => item.section).join('、') : '0 条'],
    ['向量检索 / RRF', retrieval.vector_top_k === null ? '未执行；静态预览不补造检索排名' : text(retrieval.vector_top_k)],
    ['Prompt Sources', retrieval.prompt_sources?.length ? retrieval.prompt_sources.join('、') : '未调用 LLM Prompt'],
    ['最终模式', text(retrieval.mode)],
  ].forEach(([label, value], index) => {
    const item = createElement('article', 'live-stage');
    item.append(createElement('span', 'step-index', String(index + 1).padStart(2, '0')), createElement('strong', '', label), createElement('p', '', value));
    pipeline.append(item);
  });
}

function renderLocalTraces() {
  const traces = loadLocalTraces();
  const empty = document.querySelector('#live-empty');
  const content = document.querySelector('#live-content');
  const select = document.querySelector('#live-trace-select');
  empty.hidden = traces.length > 0;
  content.hidden = traces.length === 0;
  select.replaceChildren();
  traces.forEach((trace, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${text(trace.request_id)} · ${text(trace.intent)} · ${text(trace.original_question)}`;
    select.append(option);
  });
  if (traces.length) renderLocalTrace(traces[0]);
  select.onchange = () => renderLocalTrace(traces[Number(select.value)]);
}

function activateView(name) {
  document.querySelectorAll('[data-view]').forEach((view) => {
    const active = view.dataset.view === name;
    view.hidden = !active;
    view.classList.toggle('active', active);
  });
  document.querySelectorAll('[data-view-target]').forEach((tab) => {
    const active = tab.dataset.viewTarget === name;
    tab.classList.toggle('active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  if (window.location.hash !== `#${name}`) history.replaceState(null, '', `#${name}`);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function deltaLabel(current, previous) {
  if (!previous || current === null || current === undefined) return { value: '基线', className: 'neutral' };
  const delta = Number(current) - Number(previous);
  if (Math.abs(delta) < 0.05) return { value: '持平', className: 'neutral' };
  return { value: `${delta > 0 ? '+' : ''}${delta.toFixed(1)}pp`, className: delta > 0 ? 'positive' : 'negative' };
}

function createMetricCell(value, previous) {
  const delta = deltaLabel(value, previous);
  const cell = createElement('span', 'version-score');
  cell.append(createElement('strong', '', rate(value)), createElement('small', delta.className, delta.value));
  return cell;
}

function renderVersions(data, select) {
  const list = document.querySelector('#version-list');
  list.replaceChildren();
  data.runs.forEach((run, index) => {
    const previous = data.runs[index - 1];
    const deltas = previous ? metricKeys.map((key) => Number(run[key]) - Number(previous[key])) : [];
    const hasRegression = deltas.some((value) => value < -0.05);
    const hasImprovement = deltas.some((value) => value > 0.05);
    const row = createElement('div', `version-row${hasRegression ? ' regression' : ''}`);
    const name = createElement('div', 'version-name');
    name.append(createElement('strong', '', run.label), createElement('small', '', `${text(run.captured_at)} · ${run.submitted} 条真实回答`));
    row.append(name);
    metricKeys.forEach((key) => row.append(createMetricCell(run[key], previous?.[key])));
    const status = createElement('div', 'version-status');
    status.append(createElement('span', hasRegression ? 'status-regression' : hasImprovement ? 'status-improved' : 'status-neutral', index === 0 ? '基线' : hasRegression ? '存在回归' : hasImprovement ? '有改善' : '持平'));
    if (hasRegression) {
      const button = createElement('button', '', '查看边界用例');
      button.type = 'button';
      button.title = '历史失败明细未保存；跳转到当前快照中的边界用例进行链路检查';
      button.addEventListener('click', () => {
        const boundaryIndex = data.traces.findIndex((trace) => trace.expected_behavior === 'abstain');
        if (boundaryIndex >= 0) {
          select.value = String(boundaryIndex);
          renderTrace(data.traces[boundaryIndex]);
        }
        activateView('traces');
      });
      status.append(button, createElement('small', 'history-missing', '历史失败明细未保存'));
    }
    row.append(status);
    list.append(row);
  });
}

function renderPipeline(data) {
  const list = document.querySelector('#pipeline-list');
  list.replaceChildren();
  data.pipeline.forEach((step, index) => {
    const card = createElement('article', 'pipeline-step');
    card.append(createElement('span', 'step-index', `0${index + 1}`), createElement('b', '', step.label), createElement('p', '', step.detail));
    list.append(card);
  });
  const chain = document.querySelector('#case-chain-list');
  chain.replaceChildren();
  ['用户问题', 'Query处理', '关键词/向量召回', 'RRF排序', 'Top K Chunks', 'Prompt Context', 'LLM Answer', 'Rule Verifier', '最终判定']
    .forEach((label) => chain.append(createElement('li', '', label)));
}

async function boot() {
  if (['127.0.0.1', 'localhost'].includes(window.location.hostname)) {
    document.querySelector('#preview-badge').hidden = false;
    document.querySelector('#demo-link').href = '/preview/shared/';
  }
  const response = await fetch('./data.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`无法加载评测数据：HTTP ${response.status}`);
  const data = await response.json();
  const latest = data.latest_run;
  const e2ePassed = Math.round(latest.submitted * latest.end_to_end_pass_rate / 100);
  const boundaryPassed = Math.round(latest.boundary_cases * latest.boundary_pass_rate / 100);
  document.querySelector('#run-title').textContent = `${latest.label} · ${latest.submitted} 条真实 API 回答`;
  document.querySelector('#run-notice').textContent = data.notice;
  document.querySelector('#run-date').textContent = text(latest.captured_at);
  document.querySelector('#metric-e2e').textContent = `${e2ePassed}/${latest.submitted} · ${rate(latest.end_to_end_pass_rate)}`;
  document.querySelector('#metric-e2e-note').textContent = '回答 + 来源联合判定';
  document.querySelector('#metric-coverage').textContent = rate(latest.condition_coverage);
  document.querySelector('#metric-coverage-note').textContent = '快照未记录规则条件分母';
  document.querySelector('#metric-boundary').textContent = `${boundaryPassed}/${latest.boundary_cases} · ${rate(latest.boundary_pass_rate)}`;
  document.querySelector('#metric-boundary-note').textContent = '6条知识边界用例';
  document.querySelector('#metric-p95').textContent = latency(latest.p95_ms);
  document.querySelector('#metric-p95-note').textContent = '真实 API 快照 · 当前未设置 SLA';
  renderPipeline(data);

  const select = document.querySelector('#trace-select');
  data.traces.forEach((trace, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${trace.id} · ${trace.category} · ${trace.question}`;
    select.append(option);
  });
  select.addEventListener('change', () => renderTrace(data.traces[Number(select.value)]));
  document.querySelector('#boundary-case-button').addEventListener('click', () => {
    const boundaryIndex = data.traces.findIndex((trace) => trace.expected_behavior === 'abstain');
    if (boundaryIndex >= 0) {
      select.value = String(boundaryIndex);
      renderTrace(data.traces[boundaryIndex]);
    }
  });
  renderTrace(data.traces[0]);
  renderVersions(data, select);
  document.querySelectorAll('[data-view-target]').forEach((tab) => tab.addEventListener('click', () => activateView(tab.dataset.viewTarget)));
  renderLocalTraces();
  document.querySelector('#refresh-live-traces').addEventListener('click', renderLocalTraces);
  const initialView = ['overview', 'versions', 'traces', 'live'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'overview';
  activateView(initialView);
}

boot().catch((error) => {
  document.querySelector('#run-title').textContent = '评测数据加载失败';
  document.querySelector('#run-notice').textContent = error.message;
});
