import assert from 'node:assert/strict';
import test from 'node:test';

import {
  patchConversationSource,
  patchSharedAgentSource,
  patchSharedConversationSource,
} from './patch_abstain_sources.mjs';

const sharedFixture = `
            if (data.type === 'end') {
              // set status to 'idle'
              dispatch(sharedConversationSlice.actions.setStatus('idle'));
            }
`;

const conversationFixture = `
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
  assert.match(patched, /const isKnowledgeBoundaryRefusal =/);
  assert.match(patched, /query: \{ sources: \[\] \}/);
  assert.equal(patchSharedConversationSource(patched), patched);
});

test('clears refusal sources in the regular agent streaming end event', () => {
  const patched = patchConversationSource(conversationFixture);
  assert.match(patched, /const shouldHideSourcesForBoundaryRefusal =/);
  assert.match(patched, /conversationId: currentConversationId/);
  assert.match(patched, /query: \{ sources: \[\] \}/);
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
