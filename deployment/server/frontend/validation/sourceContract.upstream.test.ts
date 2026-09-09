import { beforeEach, describe, expect, it, vi } from 'vitest';

import conversationService from '../api/services/conversationService';
import { handleFetchSharedAnswerStreaming } from './conversationHandlers';
import conversationReducer, {
  fetchAnswer,
  mapServerQueryToClient,
} from './conversationSlice';
import sharedReducer, {
  fetchSharedAnswer,
  setFetchedData,
} from './sharedConversationSlice';

const cited = { title: 'a.md', text: '运费规则\n平台承担', link: '' };
const candidate = { title: 'b.md', text: '发票规则\n寄回发票', link: '' };

describe('patched final-source lifecycle', () => {
  beforeEach(() => localStorage.clear());

  it('sanitizes regular persisted history before it reaches Redux', () => {
    const mapped = mapServerQueryToClient({
      status: 'complete',
      response: '平台承担。\n来源：a.md · 运费规则',
      sources: [cited, candidate],
    });
    expect(mapped.sources).toEqual([cited]);
  });

  it('sanitizes shared server and local history before restoring it', () => {
    localStorage.setItem('shared-id', JSON.stringify([{
      prompt: 'local', response: '无来源说明', sources: [candidate],
    }]));
    const state = sharedReducer(undefined, setFetchedData({
      identifier: 'shared-id', title: 'x', date: 'now',
      queries: [{ prompt: 'server', response: '平台承担。\n来源：a.md · 运费规则', sources: [cited, candidate] }],
    }));
    expect(state.queries[0].sources).toEqual([cited]);
    expect(state.queries[1].sources).toEqual([]);
  });

  it('clears partial answers and candidates on shared and regular rejection', () => {
    const shared = sharedReducer({
      queries: [{ prompt: 'q', response: 'partial', sources: [candidate] }],
      identifier: 'id', status: 'loading',
    }, { type: fetchSharedAnswer.rejected.type, meta: { aborted: true } });
    expect(shared.queries[0]).toMatchObject({ response: '', sources: [] });

    const regular = conversationReducer({
      queries: [{ prompt: 'q', response: 'partial', sources: [candidate] }],
      conversationId: 'c', status: 'loading',
    }, { type: fetchAnswer.rejected.type, meta: { aborted: false } });
    expect(regular.queries[0].response).toBeUndefined();
    expect(regular.queries[0].sources).toBeUndefined();
  });

  it('turns a clean shared EOF without end into a terminal error event', async () => {
    const encoder = new TextEncoder();
    vi.spyOn(conversationService, 'answerStream').mockResolvedValue(new Response(
      new ReadableStream({ start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"answer","answer":"partial"}\n'));
        controller.close();
      } }),
    ));
    const events: string[] = [];
    await handleFetchSharedAnswerStreaming('q', new AbortController().signal, 'key', [], [], (event) => events.push(event.data));
    expect(events.some((raw) => JSON.parse(raw).type === 'error')).toBe(true);
  });
});
