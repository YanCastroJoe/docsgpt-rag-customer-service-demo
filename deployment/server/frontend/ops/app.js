const text = (value, fallback = '--') => value === null || value === undefined ? fallback : String(value);
const rate = (value) => value === null || value === undefined ? '--' : `${Number(value).toFixed(value % 1 ? 1 : 0)}%`;
const latency = (value) => value === null || value === undefined ? '--' : `${(Number(value) / 1000).toFixed(1)} s`;

function line(label, value, className = '') {
  return `<div class="trace-line"><span>${label}</span><span class="${className}">${value}</span></div>`;
}

function renderTrace(trace) {
  const detail = document.querySelector('#trace-detail');
  const failures = trace.failure_types.length ? trace.failure_types.join('、') : '无';
  detail.innerHTML = [
    line('问题', trace.question),
    line('期望行为', trace.expected_behavior === 'answer' ? '知识命中回答' : '知识边界拒答'),
    line('记录来源', trace.sources.length ? trace.sources.join('、') : '未记录来源'),
    line('回答摘录', trace.answer_excerpt || '未记录回答'),
    line('规则验证', trace.overall_pass ? '通过' : `未通过：${failures}`, trace.overall_pass ? 'status-pass' : 'status-fail'),
    line('条件覆盖', rate(trace.condition_coverage)),
    line('响应耗时', latency(trace.latency_ms)),
  ].join('');
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

  document.querySelector('#pipeline-list').innerHTML = data.pipeline.map((step, index) => `
    <article class="pipeline-step">
      <span class="step-index">0${index + 1}</span>
      <b>${step.label}</b>
      <p>${step.detail}</p>
    </article>`).join('');

  document.querySelector('#version-list').innerHTML = data.runs.map((run) => `
    <div class="version-row">
      <div><strong>${run.label}</strong><small>${text(run.captured_at)} · ${run.submitted} 条</small></div>
      <span class="version-score">${rate(run.end_to_end_pass_rate)}</span>
    </div>`).join('');

  const select = document.querySelector('#trace-select');
  select.innerHTML = data.traces.map((trace, index) =>
    `<option value="${index}">${trace.id} · ${trace.category} · ${trace.question}</option>`
  ).join('');
  select.addEventListener('change', () => renderTrace(data.traces[Number(select.value)]));
  renderTrace(data.traces[0]);
}

boot().catch((error) => {
  document.querySelector('#run-title').textContent = '评测数据加载失败';
  document.querySelector('#run-notice').textContent = error.message;
});
