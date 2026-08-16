import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REFUSAL_START = '当前知识库中未找到相关信息';
const REFUSAL_END = '建议联系人工客服确认';

const SHARED_PATCH_MARKER = 'const isKnowledgeBoundaryRefusal =';
const SHARED_END_EVENT_MARKER = `if (data.type === 'end') {
              // set status to 'idle'`;

const SHARED_END_EVENT_REPLACEMENT = `if (data.type === 'end') {
              const latestState = getState() as RootState;
              const latestIndex = latestState.sharedConversation.queries.length - 1;
              const finalResponse =
                latestState.sharedConversation.queries[latestIndex]?.response ?? '';
              const isKnowledgeBoundaryRefusal =
                finalResponse.includes('${REFUSAL_START}') &&
                finalResponse.includes('${REFUSAL_END}');

              if (isKnowledgeBoundaryRefusal) {
                dispatch(
                  updateStreamingSource({
                    index: latestIndex,
                    query: { sources: [] },
                  }),
                );
              }

              // set status to 'idle'`;

const CONVERSATION_PATCH_MARKER = 'const shouldHideSourcesForBoundaryRefusal =';
const CONVERSATION_END_MARKER = `const currentState = getState() as RootState;
              if (currentState.conversation.queries[targetIndex]?.research) {`;

const CONVERSATION_END_REPLACEMENT = `const currentState = getState() as RootState;
              const finalResponse =
                currentState.conversation.queries[targetIndex]?.response ?? '';
              const shouldHideSourcesForBoundaryRefusal =
                finalResponse.includes('${REFUSAL_START}') &&
                finalResponse.includes('${REFUSAL_END}');

              if (shouldHideSourcesForBoundaryRefusal) {
                dispatch(
                  updateStreamingSource({
                    conversationId: currentConversationId,
                    index: targetIndex,
                    query: { sources: [] },
                  }),
                );
              }

              if (currentState.conversation.queries[targetIndex]?.research) {`;

const REQUEST_CONFIG_PATCH_MARKER = 'const selectedDocsForRequest =';
const REQUEST_CONFIG_MARKER = `const modelId =
    state.preference.selectedAgent?.default_model_id ||
    state.preference.selectedModel?.id;`;
const REQUEST_CONFIG_REPLACEMENT = `${REQUEST_CONFIG_MARKER}
  const selectedAgent = state.preference.selectedAgent;
  const agentSourceIds =
    selectedAgent?.sources && selectedAgent.sources.length > 0
      ? selectedAgent.sources
      : selectedAgent?.source
        ? [selectedAgent.source]
        : [];
  const selectedDocsForRequest =
    agentSourceIds.length > 0
      ? agentSourceIds.map((sourceId) => ({
          id: sourceId,
          name: sourceId,
          date: '',
          model: '',
          retriever: selectedAgent?.retriever || 'classic',
        }))
      : state.preference.selectedDocs || [];
  const promptIdForRequest =
    selectedAgent?.prompt_id || state.preference.prompt.id;
  const chunksForRequest = selectedAgent?.chunks || state.preference.chunks;`;

const AGENT_READY_PATCH_MARKER =
  '// Ensure retrieval settings are available before the input is rendered.';
const AGENT_READY_MARKER = `const agent: Agent = await response.json();
      setSharedAgent(agent);`;
const AGENT_READY_REPLACEMENT = `const agent: Agent = await response.json();
      ${AGENT_READY_PATCH_MARKER}
      dispatch(setSelectedAgent(agent));
      setSharedAgent(agent);`;
const AGENT_SUBMIT_PATCH_MARKER =
  '// Re-apply the shared Agent atomically with the answer request.';
const AGENT_SUBMIT_MARKER = `const handleFetchAnswer = useCallback(
    ({ question, index }: { question: string; index?: number }) => {
      fetchStream.current = dispatch(fetchAnswer({ question, indx: index }));
    },
    [dispatch],
  );`;
const AGENT_SUBMIT_REPLACEMENT = `const handleFetchAnswer = useCallback(
    ({ question, index }: { question: string; index?: number }) => {
      ${AGENT_SUBMIT_PATCH_MARKER}
      if (sharedAgent) dispatch(setSelectedAgent(sharedAgent));
      fetchStream.current = dispatch(fetchAnswer({ question, indx: index }));
    },
    [dispatch, sharedAgent],
  );`;

function replaceOnce(source, marker, replacement, patchMarker, description) {
  if (source.includes(patchMarker)) return source;
  if (!source.includes(marker)) {
    throw new Error(`Expected ${description} marker was not found`);
  }
  return source.replace(marker, replacement);
}

export function patchSharedConversationSource(source) {
  return replaceOnce(
    source,
    SHARED_END_EVENT_MARKER,
    SHARED_END_EVENT_REPLACEMENT,
    SHARED_PATCH_MARKER,
    'shared conversation end-event',
  );
}

export function patchConversationSource(source) {
  let patched = replaceOnce(
    source,
    CONVERSATION_END_MARKER,
    CONVERSATION_END_REPLACEMENT,
    CONVERSATION_PATCH_MARKER,
    'conversation end-event',
  );
  if (!patched.includes(REQUEST_CONFIG_PATCH_MARKER)) {
    if (!patched.includes(REQUEST_CONFIG_MARKER)) {
      throw new Error('Expected agent request configuration marker was not found');
    }
    patched = patched.replaceAll(
      'state.preference.selectedDocs || []',
      'selectedDocsForRequest',
    );
    patched = patched.replaceAll(
      'state.preference.prompt.id',
      'promptIdForRequest',
    );
    patched = patched.replaceAll(
      'state.preference.chunks',
      'chunksForRequest',
    );
    patched = patched.replace(REQUEST_CONFIG_MARKER, REQUEST_CONFIG_REPLACEMENT);
  }
  return patched;
}

export function patchSharedAgentSource(source) {
  let patched = replaceOnce(
    source,
    AGENT_READY_MARKER,
    AGENT_READY_REPLACEMENT,
    AGENT_READY_PATCH_MARKER,
    'shared agent initialization',
  );
  patched = replaceOnce(
    patched,
    AGENT_SUBMIT_MARKER,
    AGENT_SUBMIT_REPLACEMENT,
    AGENT_SUBMIT_PATCH_MARKER,
    'shared agent submit handler',
  );
  return patched;
}

export function patchSourceTree(sourceRoot) {
  const targets = [
    ['conversation/sharedConversationSlice.ts', patchSharedConversationSource],
    ['conversation/conversationSlice.ts', patchConversationSource],
    ['agents/SharedAgent.tsx', patchSharedAgentSource],
  ];

  for (const [relativePath, patcher] of targets) {
    const target = join(sourceRoot, relativePath);
    const original = readFileSync(target, 'utf8');
    writeFileSync(target, patcher(original), 'utf8');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  patchSourceTree(process.argv[2] ?? '/app/src');
}
