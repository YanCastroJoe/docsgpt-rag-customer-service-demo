import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REFUSAL_START = '当前知识库中未找到相关信息';
const REFUSAL_END = '建议联系人工客服确认';

const FILTER_HELPER_MARKER = 'function filterFinalAnswerSources<T>(';
export const FILTER_HELPER = `function filterFinalAnswerSources<T>(response: unknown, sources: T[] | undefined): T[] {
  if (typeof response !== 'string' || !Array.isArray(sources)) return [];
  const refusalText = response.split(/\\r?\\n/u).filter((line) => !/^\\s*来源\\s*[:：]/u.test(line)).join('\\n').trim();
  if (/^(?:抱歉\\s*[,，。]?\\s*)?${REFUSAL_START}\\s*[,，。；;!！]?\\s*${REFUSAL_END}\\s*[。.!！]?$/u.test(refusalText)) return [];
  const sourceLines = response.split(/\\r?\\n/u).filter((line) => /来源\\s*[:：]/u.test(line));
  if (!sourceLines.length) return [];
  const identifiers = sources.map((source) => {
    if (!source || typeof source !== 'object') return { files: [], details: [] };
    const fields = source as T & Record<string, unknown>;
    const text = String(fields.text ?? fields.page_content ?? '');
    const heading = text.split(/\\r?\\n/u).find((line) => line.trim())?.trim();
    const metadata = fields.metadata && typeof fields.metadata === 'object' ? fields.metadata as Record<string, unknown> : {};
    const clean = (values: unknown[]) => values.map((value) => String(value ?? '').trim()).filter((value) => value);
    return {
      files: clean([fields.title, fields.file, fields.filename, fields.source, metadata.title, metadata.file, metadata.filename, metadata.source]),
      details: clean([heading, fields.heading, fields.section, fields.chunk_id, fields.id, metadata.heading, metadata.section, metadata.chunk_id, metadata.id]),
    };
  });
  const matches = (line: string, value: string) => {
    const escaped = value.replace(/[$.*+?^{}()|[\\]\\\\]/g, '\\\\$&');
    return new RegExp(\`(?:^|[\\\\s·《（(:：])\${escaped}(?:$|[\\\\s·》）)])\`, 'u').test(line);
  };
  return sources.filter((_source, index) => sourceLines.some((line) => identifiers[index].details.some((detail) => {
    if (!matches(line, detail)) return false;
    if (identifiers.filter((item) => item.details.includes(detail)).length === 1) return true;
    return identifiers[index].files.some((file) => matches(line, file) && identifiers.filter((item) => item.files.includes(file) && item.details.includes(detail)).length === 1);
  })));
}\n\n`;

const SHARED_PATCH_MARKER = 'const finalSources = filterFinalAnswerSources(finalResponse, currentSources);';
const SHARED_END_EVENT_MARKER = `if (data.type === 'end') {
              // set status to 'idle'`;

export const SHARED_END_EVENT_REPLACEMENT = `if (data.type === 'end') {
              const latestState = getState() as RootState;
              const latestIndex = latestState.sharedConversation.queries.length - 1;
              const finalResponse =
                latestState.sharedConversation.queries[latestIndex]?.response ?? '';
              const currentSources = pendingSources ?? [];
              const finalSources = filterFinalAnswerSources(finalResponse, currentSources);

              if (finalSources.length !== currentSources.length) {
                dispatch(
                  sharedConversationSlice.actions.updateQuery({
                    index: latestIndex,
                    query: { sources: finalSources },
                  }),
                );
              }

              // set status to 'idle'`;

const CONVERSATION_PATCH_MARKER = 'const finalSources = filterFinalAnswerSources(finalResponse, currentSources);';
const CONVERSATION_END_MARKER = `const currentState = getState() as RootState;
              if (currentState.conversation.queries[targetIndex]?.research) {`;
const CONVERSATION_V1_END_MARKER = `if (data.type === 'end') {
              dispatch(conversationSlice.actions.setStatus('idle'));`;
const CONVERSATION_V1_END_REPLACEMENT = `if (data.type === 'end') {
              const currentState = getState() as RootState;
              const finalResponse = currentState.conversation.queries[targetIndex]?.response ?? '';
              const currentSources = pendingSources ?? [];
              const finalSources = filterFinalAnswerSources(finalResponse, currentSources);
              dispatch(updateStreamingSource({ conversationId: currentConversationId, index: targetIndex, query: { sources: finalSources } }));
              dispatch(conversationSlice.actions.setStatus('idle'));`;

export const CONVERSATION_END_REPLACEMENT = `const currentState = getState() as RootState;
              const finalResponse =
                currentState.conversation.queries[targetIndex]?.response ?? '';
              const currentSources = pendingSources ?? [];
              const finalSources = filterFinalAnswerSources(finalResponse, currentSources);

              if (finalSources.length !== currentSources.length) {
                dispatch(
                  updateStreamingSource({
                    conversationId: currentConversationId,
                    index: targetIndex,
                    query: { sources: finalSources },
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

const SHARED_HANDLER_PATCH_MARKER = 'let terminalReceived = false;';
const SHARED_HANDLER_COUNTER_MARKER = 'let counterrr = 0;';
const SHARED_HANDLER_DONE_MARKER = `if (done) {
            console.log(counterrr);
            return;
          }`;
const SHARED_HANDLER_EVENT_MARKER = 'onEvent(messageEvent); // handle each message';

function replaceOnce(source, marker, replacement, patchMarker, description) {
  if (source.includes(patchMarker)) return source;
  if (!source.includes(marker)) {
    throw new Error(`Expected ${description} marker was not found`);
  }
  return source.replace(marker, () => replacement);
}

function addFilterHelper(source) {
  if (source.includes(FILTER_HELPER_MARKER)) return source;
  const marker = "const API_STREAMING = import.meta.env.VITE_API_STREAMING === 'true';";
  if (!source.includes(marker)) throw new Error('Expected API streaming marker was not found');
  return source.replace(marker, () => `${FILTER_HELPER}${marker}`);
}

export function patchSharedConversationSource(source) {
  let patched = replaceOnce(
    source,
    SHARED_END_EVENT_MARKER,
    SHARED_END_EVENT_REPLACEMENT,
    SHARED_PATCH_MARKER,
    'shared conversation end-event',
  );
  patched = addFilterHelper(patched);
  patched = patched.replace(
    'if (API_STREAMING) {\n        await handleFetchSharedAnswerStreaming(',
    'if (API_STREAMING) {\n        let pendingSources: Query[\'sources\'] = [];\n        await handleFetchSharedAnswerStreaming(',
  );
  patched = patched.replace(
    `} else if (data.type === 'source') {
              dispatch(
                updateStreamingSource({
                  index: state.sharedConversation.queries.length - 1,
                  query: { sources: data.source ?? [] },
                }),
              );
            }`,
    `} else if (data.type === 'source') {
              pendingSources = data.source ?? [];
            }`,
  );
  if (!patched.includes('const sanitize = (query: Query): Query =>')) patched = patched.replace(
    'const { queries, title, identifier, date } = action.payload;',
    `const { queries, title, identifier, date } = action.payload;
      const sanitize = (query: Query): Query => ({ ...query, sources: filterFinalAnswerSources(query.response, query.sources) });`,
  );
  if (!patched.includes("query: { response: '', sources: [] },\n              }));\n              // discard incomplete shared stream")) patched = patched.replaceAll(
    "} else if (data.type === 'error') {",
    `} else if (data.type === 'error') {
              dispatch(sharedConversationSlice.actions.updateQuery({
                index: state.sharedConversation.queries.length - 1,
                query: { response: '', sources: [] },
              }));
              // discard incomplete shared stream`,
  );
  patched = patched.replace(
    'state.queries = [...queries, ...localySavedQueries];',
    'state.queries = [...queries.map(sanitize), ...localySavedQueries.map(sanitize)];',
  );
  patched = patched.replace(
    "state.status = 'idle';\n          return;",
    "state.status = 'idle';\n          const query = state.queries[state.queries.length - 1];\n          if (query) { query.response = ''; query.sources = []; }\n          return;",
  );
  patched = patched.replace(
    "state.status = 'failed';\n        if (state.queries.length > 0) {",
    "state.status = 'failed';\n        const query = state.queries[state.queries.length - 1];\n        if (query) { query.response = ''; query.sources = []; }\n        if (state.queries.length > 0) {",
  );
  return patched;
}

export function patchConversationSource(source) {
  let patched = replaceOnce(
    source,
    CONVERSATION_END_MARKER,
    CONVERSATION_END_REPLACEMENT,
    CONVERSATION_PATCH_MARKER,
    'conversation end-event',
  );
  patched = addFilterHelper(patched);
  patched = replaceOnce(
    patched,
    CONVERSATION_V1_END_MARKER,
    CONVERSATION_V1_END_REPLACEMENT,
    'const finalSources = filterFinalAnswerSources(finalResponse, currentSources);\n              dispatch(updateStreamingSource({ conversationId:',
    'v1 conversation end-event',
  );
  if (!patched.includes("let pendingSources: Query['sources'] = [];")) patched = patched.replace(
    'let isSourceUpdated = false;',
    "let isSourceUpdated = false;\n  let pendingSources: Query['sources'] = [];",
  );
  patched = patched.replaceAll(
    `} else if (data.type === 'source') {
              isSourceUpdated = true;
              dispatch(
                updateStreamingSource({
                  conversationId: currentConversationId,
                  index: targetIndex,
                  query: { sources: data.source ?? [] },
                }),
              );
            }`,
    `} else if (data.type === 'source') {
              isSourceUpdated = true;
              pendingSources = data.source ?? [];
            }`,
  );
  if (!patched.includes('const verifiedSources = isTerminalComplete ?')) patched = patched.replace(
    'const sources = Array.isArray(raw?.sources) ? raw.sources : undefined;',
    `const sources = Array.isArray(raw?.sources) ? raw.sources : undefined;
  const verifiedSources = isTerminalComplete ? filterFinalAnswerSources<NonNullable<Query['sources']>[number]>(raw?.response, sources) : [];`,
  );
  patched = patched.replace(
    'sources: sources && sources.length > 0 ? sources : undefined,',
    'sources: verifiedSources.length > 0 ? verifiedSources : undefined,',
  );
  if (!patched.includes("query: { response: '', sources: [] },\n              }));\n              // discard incomplete conversation stream")) patched = patched.replaceAll(
    "} else if (data.type === 'error') {",
    `} else if (data.type === 'error') {
              dispatch(conversationSlice.actions.updateQuery({
                index: targetIndex,
                query: { response: '', sources: [] },
              }));
              // discard incomplete conversation stream`,
  );
  patched = patched.replace(
    "state.status = 'idle';\n          return;",
    "state.status = 'idle';\n          const query = state.queries[state.queries.length - 1];\n          if (query) { delete query.response; delete query.sources; }\n          return;",
  );
  patched = patched.replace(
    "state.status = 'failed';\n        if (state.queries.length > 0) {",
    "state.status = 'failed';\n        const query = state.queries[state.queries.length - 1];\n        if (query) { delete query.response; delete query.sources; }\n        if (state.queries.length > 0) {",
  );
  if (!patched.includes(REQUEST_CONFIG_PATCH_MARKER)) {
    if (!patched.includes(REQUEST_CONFIG_MARKER)) {
      throw new Error('Expected agent request configuration marker was not found');
    }
    patched = patched.replaceAll(
      'state.preference.selectedDocs || []',
      () => 'selectedDocsForRequest',
    );
    patched = patched.replaceAll(
      'state.preference.prompt.id',
      () => 'promptIdForRequest',
    );
    patched = patched.replaceAll(
      'state.preference.chunks',
      () => 'chunksForRequest',
    );
    patched = patched.replace(REQUEST_CONFIG_MARKER, () => REQUEST_CONFIG_REPLACEMENT);
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

export function patchConversationHandlersSource(source) {
  if (source.includes(SHARED_HANDLER_PATCH_MARKER)) return source;
  for (const [marker, description] of [
    [SHARED_HANDLER_COUNTER_MARKER, 'shared handler counter'],
    [SHARED_HANDLER_DONE_MARKER, 'shared handler done branch'],
    [SHARED_HANDLER_EVENT_MARKER, 'shared handler event dispatch'],
  ]) {
    if (!source.includes(marker)) throw new Error(`Expected ${description} marker was not found`);
  }
  let patched = source.replace(
    SHARED_HANDLER_COUNTER_MARKER,
    () => `${SHARED_HANDLER_COUNTER_MARKER}\n        ${SHARED_HANDLER_PATCH_MARKER}`,
  );
  patched = patched.replace(
    SHARED_HANDLER_DONE_MARKER,
    () => `if (done) {
            console.log(counterrr);
            if (!terminalReceived && !signal.aborted) {
              onEvent(new MessageEvent('message', { data: JSON.stringify({ type: 'error', error: 'Connection lost before the final event; please try again.' }) }));
            }
            resolve(undefined as unknown as Answer);
            return;
          }`,
  );
  patched = patched.replace(
    SHARED_HANDLER_EVENT_MARKER,
    () => `try {
              const parsed = JSON.parse(line);
              if (parsed?.type === 'end' || parsed?.type === 'error') terminalReceived = true;
            } catch {
              // The slice owns malformed-frame handling.
            }
            ${SHARED_HANDLER_EVENT_MARKER}`,
  );
  return patched;
}

export function patchSourceTree(sourceRoot) {
  const targets = [
    ['conversation/sharedConversationSlice.ts', patchSharedConversationSource],
    ['conversation/conversationSlice.ts', patchConversationSource],
    ['conversation/conversationHandlers.ts', patchConversationHandlersSource],
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
