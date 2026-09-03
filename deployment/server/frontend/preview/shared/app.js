import { TRACE_STORAGE_KEY, buildTrace, resolveQuestion } from './rag_logic.mjs?v=rag-ui-live-v1';

const suggestions = [
  { label: '退货运费', question: '质量问题退货时，运费由谁承担？' },
  { label: '退款时效', question: '我的退款什么时候到账？' },
  { label: '复合问题', question: '商品有质量问题，签收超过15天还能退吗？运费谁承担？' },
  { label: '能力范围', question: '我可以问任何问题吗？' },
];

const sharedAgentToken = document.querySelector('meta[name="shared-agent-token"]')?.content?.trim() || '';
const liveMode = Boolean(sharedAgentToken && sharedAgentToken !== '__SHARED_AGENT_TOKEN__');
const state = { busy: false, lastQuestion: '', previewEvents: [], agent: null };
window.__ragPreviewEvents = state.previewEvents;

const input = document.querySelector('#question-input');
const conversation = document.querySelector('#conversation');
const suggestionList = document.querySelector('#suggestion-list');
const welcomePanel = document.querySelector('#welcome-panel');
const sendButton = document.querySelector('#send-button');
const composerStatus = document.querySelector('#composer-status');
const toast = document.querySelector('#toast');
const serviceStatus = document.querySelector('.service-status strong');
const serviceDetail = document.querySelector('.service-status small');

const createElement = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 2200);
}

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
}

function fillQuestion(question) {
  input.value = question;
  autoGrow();
  input.focus();
}

function appendUserMessage(question) {
  const wrapper = createElement('div', 'message user-message');
  const bubble = createElement('div');
  bubble.append(createElement('p', '', question));
  wrapper.append(bubble);
  conversation.append(wrapper);
}

function appendLoading() {
  const wrapper = createElement('div', 'message assistant-message loading-message');
  wrapper.dataset.loading = 'true';
  wrapper.append(createElement('span', 'avatar', 'R'));
  const bubble = createElement('div', 'loading-bubble');
  bubble.append(createElement('span', 'loading-dot'), createElement('p', '', '正在理解问题…'));
  wrapper.append(bubble);
  conversation.append(wrapper);
  conversation.scrollTop = conversation.scrollHeight;
  return wrapper;
}

function openSource(sourceRecord) {
  const unavailable = liveMode ? '当前接口未提供' : '本地静态预览未提供';
  document.querySelector('#source-index').textContent = sourceRecord.section || '回答依据';
  document.querySelector('#source-file').textContent = sourceRecord.file || unavailable;
  document.querySelector('#source-version').textContent = sourceRecord.version || (liveMode ? '当前云端知识库' : '边界增强V3 · 本地知识快照');
  document.querySelector('#source-chunk').textContent = sourceRecord.chunk || unavailable;
  document.querySelector('#source-snippet').textContent = sourceRecord.snippet || unavailable;
  document.querySelector('#source-location').textContent = sourceRecord.location || unavailable;
  document.querySelector('#source-score').textContent = sourceRecord.score || (liveMode ? unavailable : '不适用（确定性规则预览）');
  document.querySelector('#drawer-backdrop').hidden = false;
  document.querySelector('#source-drawer').hidden = false;
  document.body.classList.add('drawer-open');
  document.querySelector('#close-source').focus();
}

function closeSource() {
  document.querySelector('#drawer-backdrop').hidden = true;
  document.querySelector('#source-drawer').hidden = true;
  document.body.classList.remove('drawer-open');
}

function createSourceButton(sourceRecord, label = '查看依据') {
  const button = createElement('button', 'source-reference', label);
  button.type = 'button';
  button.addEventListener('click', () => openSource(sourceRecord));
  return button;
}

function recordFeedback(type, reason = null) {
  state.previewEvents.push({ type, reason, question: state.lastQuestion, at: new Date().toISOString() });
  showToast(reason ? `已记录：${reason}（仅本地预览）` : '感谢反馈（仅本地预览）');
}

function createFeedbackPanel() {
  const panel = createElement('div', 'feedback-panel');
  panel.hidden = true;
  panel.append(createElement('strong', '', '哪里需要改进？'));
  ['答非所问', '信息不完整', '来源不正确', '政策可能过期', '回答难以理解'].forEach((reason) => {
    const button = createElement('button', '', reason);
    button.type = 'button';
    button.addEventListener('click', () => { recordFeedback('not_helpful', reason); panel.hidden = true; });
    panel.append(button);
  });
  panel.append(createElement('small', '', '反馈事件仅保存在本地预览内存中。'));
  return panel;
}

function createAnswerActions(answerText, sourceRecords = []) {
  const container = createElement('div', 'answer-actions');
  if (sourceRecords.length) {
    const sourcesButton = createElement('button', '', `查看来源 · ${sourceRecords.length}`);
    sourcesButton.type = 'button';
    sourcesButton.addEventListener('click', () => openSource(sourceRecords[0]));
    container.append(sourcesButton);
  }
  const copyButton = createElement('button', '', '复制');
  copyButton.type = 'button';
  copyButton.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(answerText); showToast('回答已复制'); }
    catch { showToast('复制失败，请手动选择文本'); }
  });
  const helpful = createElement('button', '', '有帮助');
  helpful.type = 'button';
  helpful.addEventListener('click', () => recordFeedback('helpful'));
  const notHelpful = createElement('button', '', '没帮助');
  notHelpful.type = 'button';
  const retry = createElement('button', '', '重新生成');
  retry.type = 'button';
  retry.addEventListener('click', () => runQuestion(state.lastQuestion, { appendUser: false }));
  const feedbackPanel = createFeedbackPanel();
  notHelpful.addEventListener('click', () => { feedbackPanel.hidden = !feedbackPanel.hidden; });
  container.append(copyButton, helpful, notHelpful, retry, feedbackPanel);
  return container;
}

function addRecoveryActions(container, result) {
  const actions = createElement('div', 'recovery-actions');
  const add = (label, action) => {
    const button = createElement('button', '', label);
    button.type = 'button';
    button.addEventListener('click', action);
    actions.append(button);
  };
  if (result.intent === 'out_of_scope' || result.intent === 'capability_scope') {
    add('查看可咨询问题', () => fillQuestion('质量问题退货时，运费由谁承担？'));
  } else if (result.intent.includes('personal_data')) {
    add('了解一般退款时效', () => fillQuestion('普通商品退货退款通常要多久？'));
    add('联系人工客服', () => showToast('请前往订单详情页联系平台人工客服'));
  } else if (result.intent === 'knowledge_not_found' || result.intent === 'compound_after_sales') {
    add('补充售后情况', () => fillQuestion(`${result.originalQuestion}，具体情况是：`));
    add('联系人工客服', () => showToast('请前往订单详情页联系平台人工客服'));
  }
  if (actions.childElementCount) container.append(actions);
}

function appendResult(result) {
  const wrapper = createElement('div', 'message assistant-message');
  wrapper.append(createElement('span', 'avatar', 'R'));
  const tone = result.refusalReason ? ` ${result.coverage.status}` : '';
  const bubble = createElement('div', `answer-block${tone}`);
  bubble.append(createElement('strong', 'answer-headline', result.headline));

  if (result.coverage.total > 1) {
    const coverage = createElement('div', `coverage-badge ${result.coverage.status}`);
    coverage.textContent = result.coverage.status === 'partial_answer'
      ? `已处理 ${result.coverage.handled}/${result.coverage.total} 个子问题，其中 ${result.coverage.fullyAnswered} 个有完整依据`
      : `已覆盖 ${result.coverage.handled}/${result.coverage.total} 个子问题`;
    bubble.append(coverage);
  }

  result.sections.forEach((item) => {
    const sectionNode = createElement('section', 'answer-section');
    sectionNode.append(createElement('h3', '', item.title), createElement('p', '', item.text));
    item.sourceIds.forEach((sourceId) => {
      const sourceRecord = result.sources.find((entry) => entry.id === sourceId);
      if (sourceRecord) sectionNode.append(createSourceButton(sourceRecord));
    });
    bubble.append(sectionNode);
  });
  addRecoveryActions(bubble, result);
  const answerText = result.sections.map((item) => `${item.title}：${item.text}`).join('\n');
  bubble.append(createAnswerActions(answerText, result.sources));
  wrapper.append(bubble);
  conversation.append(wrapper);
}

function saveTrace(trace) {
  try {
    const current = JSON.parse(localStorage.getItem(TRACE_STORAGE_KEY) || '[]');
    const next = [trace, ...(Array.isArray(current) ? current : [])].slice(0, 20);
    localStorage.setItem(TRACE_STORAGE_KEY, JSON.stringify(next));
  } catch (_) {
    showToast('本次回答正常，但浏览器未能保存诊断记录');
  }
}

const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

async function getLiveAgent() {
  if (state.agent) return state.agent;
  const response = await fetch(`/api/shared_agent?token=${encodeURIComponent(sharedAgentToken)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`共享知识库加载失败（HTTP ${response.status}）`);
  const agent = await response.json();
  if (!agent?.id || !Array.isArray(agent.sources) || agent.sources.length === 0) {
    throw new Error('共享知识库配置不完整');
  }
  state.agent = agent;
  return agent;
}

function parseStreamFrame(frame, output) {
  const payloadText = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!payloadText) return;
  let event;
  try { event = JSON.parse(payloadText); } catch { return; }
  if (event.type === 'answer' && typeof event.answer === 'string') {
    if (!event.answer.includes("'type': 'thought'")) output.answer += event.answer;
  } else if (event.type === 'source' && Array.isArray(event.source)) {
    output.sources = event.source;
  } else if (event.type === 'error') {
    throw new Error(event.error || '回答生成失败');
  }
}

function toLiveResult(answer, rawSources) {
  const sourceRecords = rawSources.map((source, index) => ({
    id: `live-source-${index + 1}`,
    section: `来源 ${index + 1}`,
    file: source.title || source.filename || source.source || '知识库文档',
    version: '当前云端知识库',
    chunk: source.chunk_id || source.id || '',
    snippet: source.text || '',
    location: source.page || source.section || '',
    score: source.score == null ? '' : String(source.score),
  }));
  const cleanedAnswer = answer.replace(/\n*来源：[^\n]+\s*$/u, '').trim();
  return {
    intent: 'live_rag',
    originalQuestion: state.lastQuestion,
    headline: sourceRecords.length ? '基于知识库的回答' : '知识库边界说明',
    sections: [{
      title: '答复',
      text: cleanedAnswer || '当前未能生成有效回答，请稍后重试。',
      sourceIds: sourceRecords.map((source) => source.id),
    }],
    sources: sourceRecords,
    coverage: { total: 1, handled: 1, fullyAnswered: sourceRecords.length ? 1 : 0, status: sourceRecords.length ? 'covered' : 'not_covered' },
    refusalReason: sourceRecords.length ? null : 'knowledge_boundary',
  };
}

async function fetchLiveResult(question) {
  const agent = await getLiveAgent();
  const activeDocs = agent.sources.length === 1 ? agent.sources[0] : agent.sources;
  const response = await fetch('/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      question,
      conversation_id: null,
      prompt_id: agent.prompt_id || null,
      chunks: String(agent.chunks || '2'),
      isNoneDoc: false,
      agent_id: agent.id,
      active_docs: activeDocs,
      retriever: agent.retriever || 'hybrid',
      save_conversation: false,
      visibility: 'hidden',
    }),
  });
  if (!response.ok || !response.body) throw new Error(`问答服务暂不可用（HTTP ${response.status}）`);

  const output = { answer: '', sources: [] };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const frames = buffer.split(/\r?\n\r?\n/);
    buffer = frames.pop() || '';
    frames.forEach((frame) => parseStreamFrame(frame, output));
    if (done) break;
  }
  if (buffer.trim()) parseStreamFrame(buffer, output);
  return toLiveResult(output.answer, output.sources);
}

async function runQuestion(question, options = { appendUser: true }) {
  if (!question || state.busy) return;
  state.busy = true;
  state.lastQuestion = question;
  const startedAt = performance.now();
  sendButton.disabled = true;
  composerStatus.textContent = '正在处理，请稍候';
  welcomePanel.hidden = true;
  if (options.appendUser) appendUserMessage(question);
  const loading = appendLoading();
  let result;
  try {
    await wait(180);
    loading.querySelector('p').textContent = liveMode ? '正在检索知识库并核对来源…' : '正在检查问题覆盖…';
    result = liveMode ? await fetchLiveResult(question) : resolveQuestion(question);
    loading.remove();
    appendResult(result);
    if (!liveMode) {
      const requestId = `preview-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      saveTrace(buildTrace(result, Math.round(performance.now() - startedAt), requestId));
    }
  } catch (error) {
    loading.remove();
    result = {
      intent: 'service_error',
      originalQuestion: question,
      headline: '暂时无法完成回答',
      sections: [{ title: '建议', text: error.message || '服务暂时不可用，请稍后重试。', sourceIds: [] }],
      sources: [],
      coverage: { total: 1, handled: 0, fullyAnswered: 0, status: 'not_covered' },
      refusalReason: 'service_error',
    };
    appendResult(result);
  }
  state.busy = false;
  sendButton.disabled = false;
  composerStatus.textContent = liveMode
    ? '回答来自当前云端知识库；个人订单请前往订单详情查询'
    : '本地知识快照回答，仅供演示；个人订单请前往订单详情查询';
  conversation.scrollTop = conversation.scrollHeight;
}

suggestions.forEach((item) => {
  const button = createElement('button', 'suggestion');
  button.type = 'button';
  button.append(createElement('small', '', item.label), createElement('span', '', item.question));
  button.addEventListener('click', () => fillQuestion(item.question));
  suggestionList.append(button);
});

document.querySelector('#question-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const question = input.value.trim();
  if (!question || state.busy) return input.focus();
  input.value = '';
  autoGrow();
  await runQuestion(question);
});

input.addEventListener('input', autoGrow);
input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    document.querySelector('#question-form').requestSubmit();
  }
});

document.querySelector('#reset-button').addEventListener('click', () => {
  conversation.querySelectorAll(':scope > .message').forEach((message) => message.remove());
  welcomePanel.hidden = false;
  input.value = '';
  autoGrow();
  input.focus();
});

document.querySelector('#close-source').addEventListener('click', closeSource);
document.querySelector('#drawer-backdrop').addEventListener('click', closeSource);
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeSource(); });
autoGrow();

if (liveMode) {
  serviceStatus.textContent = '知识库连接中';
  serviceDetail.textContent = '正在加载售后政策';
  getLiveAgent()
    .then(() => {
      serviceStatus.textContent = '知识库已连接';
      serviceDetail.textContent = '云端售后政策知识库';
    })
    .catch(() => {
      serviceStatus.textContent = '服务暂不可用';
      serviceDetail.textContent = '请稍后刷新页面';
    });
}
