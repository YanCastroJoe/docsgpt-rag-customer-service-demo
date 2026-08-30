const text = (value, fallback = '--') => value === null || value === undefined ? fallback : String(value);
const rate = (value) => value === null || value === undefined ? '--' : `${Number(value).toFixed(value % 1 ? 1 : 0)}%`;
const latency = (value) => value === null || value === undefined ? '--' : `${(Number(value) / 1000).toFixed(1)} s`;

function card(label, value, className = '', wide = false) {
  return `<article class="trace-card${wide ? ' wide' : ''}"><span>${label}</span><span class="${className}">${value}</span></article>`;
}

function renderTrace(trace) {
  const failures = trace.failure_types.length ? trace.failure_types.join('、') : '无';
  document.querySelector('#trace-detail').innerHTML = [
    card('01 · 用户问题', trace.question, '', true),
    card('02 · 期望行为', trace.expected_behavior === 'answer' ? '知识命中回答' : '知识边界拒答'),
    card('03 · 规则验证', trace.overall_pass ? '通过' : `未通过：${failures}`, trace.overall_pass ? 'status-pass' : 'status-fail'),
    card('04 · 记录来源', trace.sources.length ? trace.sources.join('、') : '未记录来源', '', true),
    card('05 · 回答摘录', trace.answer_excerpt || '未记录回答', '', true),
    card('06 · 条件覆盖', rate(trace.condition_coverage)),
    card('07 · 响应耗时', latency(trace.latency_ms)),
  ].join('');
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

async function boot() {
  const response = await fetch('./data.json', { cache: 'no-store' });
  if (!response.ok) throw new Error(`无法加载评测数据：HTTP ${response.status}`);
  const data = await response.json();
  const latest = data.latest_run;
  document.querySelector('#run-title').textContent = `${latest.label} · ${latest.submitted} 条真实回答`;
  document.querySelector('#run-notice').textContent = data.notice;
  document.querySelector('#run-date').textContent = text(latest.captured_at);
  document.querySelector('#metric-e2e').textContent = rate(latest.end_to_end_pass_rate);
  document.querySelector('#metric-coverage').textContent = rate(latest.condition_coverage);
  document.querySelector('#metric-boundary').textContent = rate(latest.boundary_pass_rate);
  document.querySelector('#metric-p95').textContent = latency(latest.p95_ms);
  document.querySelector('#pipeline-list').innerHTML = data.pipeline.map((step, index) => `<article class="pipeline-step"><span class="step-index">0${index + 1}</span><b>${step.label}</b><p>${step.detail}</p></article>`).join('');
  document.querySelector('#version-list').innerHTML = data.runs.map((run) => `<div class="version-row"><div class="version-name"><strong>${run.label}</strong><small>${text(run.captured_at)} · ${run.submitted} 条真实回答</small></div><span class="version-score primary">${rate(run.end_to_end_pass_rate)}</span><span class="version-score">${rate(run.condition_coverage)}</span><span class="version-score">${rate(run.source_hit_rate)}</span><span class="version-score">${rate(run.boundary_pass_rate)}</span></div>`).join('');
  const select = document.querySelector('#trace-select');
  select.innerHTML = data.traces.map((trace, index) => `<option value="${index}">${trace.id} · ${trace.category} · ${trace.question}</option>`).join('');
  select.addEventListener('change', () => renderTrace(data.traces[Number(select.value)]));
  renderTrace(data.traces[0]);
  document.querySelectorAll('[data-view-target]').forEach((tab) => tab.addEventListener('click', () => activateView(tab.dataset.viewTarget)));
  const initialView = ['overview', 'versions', 'traces'].includes(window.location.hash.slice(1)) ? window.location.hash.slice(1) : 'overview';
  activateView(initialView);
}

boot().catch((error) => {
  document.querySelector('#run-title').textContent = '评测数据加载失败';
  document.querySelector('#run-notice').textContent = error.message;
});
