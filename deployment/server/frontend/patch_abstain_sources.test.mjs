import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONVERSATION_END_REPLACEMENT,
  FILTER_HELPER,
  SHARED_END_EVENT_REPLACEMENT,
  patchConversationSource,
  patchSharedAgentSource,
  patchSharedConversationSource,
} from './patch_abstain_sources.mjs';

const filterFinalAnswerSources = new Function(`${FILTER_HELPER
  .replace('filterFinalAnswerSources<T>', 'filterFinalAnswerSources')
  .replace('response: unknown', 'response')
  .replace('sources: T[] | undefined', 'sources')
  .replace(': T[]', '')
  .replace('line: string', 'line')
  .replace('value: string', 'value')
  .replace('values: unknown[]', 'values')
  .replaceAll(' as T & Record<string, unknown>', '')
  .replaceAll(' as Record<string, unknown>', '')}; return filterFinalAnswerSources;`)();

function runSharedEnd(response, sources) {
  const dispatched = [];
  const body = SHARED_END_EVENT_REPLACEMENT
    .replaceAll(' as RootState', '')
    .replaceAll(' as typeof source & Record<string, unknown>', '')
    .replaceAll(' as Record<string, unknown>', '')
    .replace("// set status to 'idle'", "dispatch(sharedConversationSlice.actions.setStatus('idle'));\n}");
  new Function('data', 'getState', 'dispatch', 'sharedConversationSlice', 'filterFinalAnswerSources', 'pendingSources', body)(
    { type: 'end' },
    () => ({ sharedConversation: { queries: [{ response, sources }] } }),
    (action) => dispatched.push(action),
    { actions: {
      updateQuery: (payload) => ({ type: 'update', payload }),
      setStatus: () => ({ type: 'idle' }),
    } },
    filterFinalAnswerSources,
    sources,
  );
  return dispatched.find((action) => action.type === 'update')?.payload.query.sources ?? sources;
}

function runRegularEnd(response, sources) {
  const dispatched = [];
  const body = `${CONVERSATION_END_REPLACEMENT
    .replaceAll(' as RootState', '')
    .replaceAll(' as typeof source & Record<string, unknown>', '')
    .replaceAll(' as Record<string, unknown>', '')}\n}`;
  new Function('getState', 'dispatch', 'updateStreamingSource', 'updateResearchProgress', 'currentConversationId', 'targetIndex', 'filterFinalAnswerSources', 'pendingSources', body)(
    () => ({ conversation: { queries: [{ response, sources, research: false }] } }),
    (action) => dispatched.push(action),
    (payload) => ({ type: 'update', payload }),
    (payload) => ({ type: 'research', payload }),
    'conversation', 0, filterFinalAnswerSources, sources,
  );
  return dispatched.find((action) => action.type === 'update')?.payload.query.sources ?? sources;
}

const sharedFixture = `
const API_STREAMING = import.meta.env.VITE_API_STREAMING === 'true';
      const { queries, title, identifier, date } = action.payload;
      state.queries = [...queries, ...localySavedQueries];
      if (API_STREAMING) {
        await handleFetchSharedAnswerStreaming(
        );
      }
            if (data.type === 'end') {
              // set status to 'idle'
              dispatch(sharedConversationSlice.actions.setStatus('idle'));
            }
`;

const conversationFixture = `
const API_STREAMING = import.meta.env.VITE_API_STREAMING === 'true';
  let isSourceUpdated = false;
  const sources = Array.isArray(raw?.sources) ? raw.sources : undefined;
    sources: sources && sources.length > 0 ? sources : undefined,
            if (data.type === 'end') {
              dispatch(conversationSlice.actions.setStatus('idle'));
            }
  const modelId =
    state.preference.selectedAgent?.default_model_id ||
    state.preference.selectedModel?.id;

  await handleFetchAnswerSteaming(
    state.preference.selectedDocs || [],
    state.preference.prompt.id,
    state.preference.chunks,
  );

              const currentState = getState() as RootState;
              if (currentState.conversation.queries[targetIndex]?.research) {
                dispatch(updateResearchProgress({ index: targetIndex }));
              }
`;

const agentFixture = `
      const agent: Agent = await response.json();
      setSharedAgent(agent);

  const handleFetchAnswer = useCallback(
    ({ question, index }: { question: string; index?: number }) => {
      fetchStream.current = dispatch(fetchAnswer({ question, indx: index }));
    },
    [dispatch],
  );
`;

test('clears refusal sources in the shared streaming end event', () => {
  const patched = patchSharedConversationSource(sharedFixture);
  assert.match(patched, /filterFinalAnswerSources/);
  assert.match(patched, /query: \{ sources: finalSources \}/);
  assert.match(patched, /sharedConversationSlice\.actions\.updateQuery/);
  assert.doesNotMatch(patched, /value\.replace\([^\n]+if \(data\.type === 'end'\)/);
  assert.equal(patchSharedConversationSource(patched), patched);
});

test('injects replacement text literally when it contains JavaScript replacement tokens', () => {
  const patched = patchSharedConversationSource(sharedFixture);
  assert.ok(patched.includes("value.replace(/[$.*+?^{}()|[\\]\\\\]/g, '\\\\$&')"));
  assert.equal((patched.match(/if \(data\.type === 'end'\)/g) || []).length, 1);
});

test('clears refusal sources in the regular agent streaming end event', () => {
  const patched = patchConversationSource(conversationFixture);
  assert.match(patched, /filterFinalAnswerSources/);
  assert.match(patched, /conversationId: currentConversationId/);
  assert.match(patched, /query: \{ sources: finalSources \}/);
  assert.match(patched, /const selectedDocsForRequest =/);
  assert.match(patched, /selectedAgent\?\.sources/);
  assert.match(
    patched,
    /handleFetchAnswerSteaming\(\s*selectedDocsForRequest,/,
  );
  assert.match(patched, /promptIdForRequest/);
  assert.match(patched, /chunksForRequest/);
  assert.equal(patchConversationSource(patched), patched);
});

test('binds the shared agent before rendering the input', () => {
  const patched = patchSharedAgentSource(agentFixture);
  assert.ok(
    patched.indexOf('dispatch(setSelectedAgent(agent))') <
      patched.indexOf('setSharedAgent(agent)'),
  );
  assert.ok(
    patched.indexOf('dispatch(setSelectedAgent(sharedAgent))') <
      patched.indexOf('dispatch(fetchAnswer({ question, indx: index }))'),
  );
  assert.match(patched, /\[dispatch, sharedAgent\]/);
  assert.equal(patchSharedAgentSource(patched), patched);
});

test('fails closed when an upstream marker changes', () => {
  assert.throws(
    () => patchConversationSource('export const unrelated = true;'),
    /conversation end-event marker was not found/,
  );
});

test('injected end handlers execute the fail-closed source contract', () => {
  const right = { title: 'policy.md', text: '质量问题退货运费\n平台承担运费', id: 'chunk-10' };
  const wrong = { title: 'policy.md', text: '发票处理\n纸质发票寄回', id: 'chunk-11' };
  const nested = { title: 'policy.md', text: '正文', metadata: { section: '退款到账时效' } };
  const blank = { title: 'policy.md', text: '', id: '   ' };
  for (const run of [runSharedEnd, runRegularEnd]) {
    assert.deepEqual(run('平台承担运费。\n来源：policy.md · 质量问题退货运费', [right, wrong]), [right]);
    assert.deepEqual(run('退款1到3日。\n来源：policy.md · 退款到账时效', [nested, blank]), [nested]);
    assert.deepEqual(run('来源：chunk-1', [right]), []);
    assert.deepEqual(run('来源：chunk-10', [right]), [right]);
    assert.deepEqual(run('当前知识库中未找到相关信息。建议联系人工客服确认。\n来源：policy.md · 质量问题退货运费', [right]), []);
    assert.deepEqual(run('平台承担运费。\n当前知识库中未找到相关信息，建议联系人工客服确认。\n来源：policy.md · 质量问题退货运费', [right]), [right]);
  }
});

test('source matching fails closed for ambiguous same-title and same-heading candidates', () => {
  const first = { title: 'policy.md', text: '相同章节\nA', id: '' };
  const second = { title: 'policy.md', text: '相同章节\nB', id: '' };
  for (const run of [runSharedEnd, runRegularEnd]) {
    assert.deepEqual(run('答复。\n来源：policy.md · 相同章节', [first, second]), []);
  }
});

test('a unique file or chunk identifier can disambiguate otherwise similar candidates', () => {
  const first = { title: 'a.md', text: '相同章节\nA', id: 'chunk-a' };
  const second = { title: 'b.md', text: '相同章节\nB', id: 'chunk-b' };
  for (const run of [runSharedEnd, runRegularEnd]) {
    assert.deepEqual(run('答复。\n来源：a.md · 相同章节', [first, second]), [first]);
    assert.deepEqual(run('答复。\n来源：chunk-b', [first, second]), [second]);
  }
});

test('a file name alone is not evidence and citation lines cannot be combined', () => {
  const first = { title: 'a.md', text: '相同章节\nA' };
  const second = { title: 'b.md', text: '相同章节\nB' };
  for (const run of [runSharedEnd, runRegularEnd]) {
    assert.deepEqual(run('答复。\n来源：a.md', [first, second]), []);
    assert.deepEqual(run('答复。\n来源：a.md\n来源：相同章节', [first, second]), []);
  }
});
