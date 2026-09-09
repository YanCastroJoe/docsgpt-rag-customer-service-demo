import assert from 'node:assert/strict';
import test from 'node:test';

import { collectLiveStream, parseStreamFrame, requireCompleteLiveOutput } from './shared/live_stream.mjs';

const createOutput = () => ({ answer: '', sources: [], completed: false });

test('a normal stream becomes eligible only after an explicit end event', () => {
  const result = createOutput();
  parseStreamFrame('data: {"type":"source","source":[{"id":"candidate"}]}', result);
  parseStreamFrame('data: {"type":"answer","answer":"最终答复"}', result);
  assert.throws(() => requireCompleteLiveOutput(result), /意外中断/);
  parseStreamFrame('data: {"type":"end"}', result);
  assert.equal(requireCompleteLiveOutput(result), result);
});

test('an interrupted stream cannot promote partial text and candidate sources', () => {
  const result = createOutput();
  parseStreamFrame('data: {"type":"source","source":[{"id":"candidate"}]}', result);
  parseStreamFrame('data: {"type":"answer","answer":"半截回答"}', result);
  assert.deepEqual(result.sources, [{ id: 'candidate' }]);
  assert.throws(() => requireCompleteLiveOutput(result), /意外中断/);
});

test('an explicit stream error remains a service error even after candidates arrived', () => {
  const result = createOutput();
  parseStreamFrame('data: {"type":"source","source":[{"id":"candidate"}]}', result);
  assert.throws(
    () => parseStreamFrame('data: {"type":"error","error":"upstream failed"}', result),
    /upstream failed/,
  );
});

test('end without an answer is not a successful final answer', () => {
  const result = createOutput();
  parseStreamFrame('data: {"type":"end"}', result);
  assert.throws(() => requireCompleteLiveOutput(result), /未生成有效回答/);
});

function mockSse(chunks) {
  const encoder = new TextEncoder();
  return {
    body: new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(encoder.encode(chunk)));
        controller.close();
      },
    }),
  };
}

test('mock SSE accepts a chunk-split answer only when end is received', async () => {
  const response = mockSse([
    'data: {"type":"source","source":[{"id":"chunk-1"}]}\n\nda',
    'ta: {"type":"answer","answer":"完整回答"}\n\ndata: {"type":"end"}\n\n',
  ]);
  assert.deepEqual(await collectLiveStream(response), {
    answer: '完整回答', sources: [{ id: 'chunk-1' }], completed: true,
  });
});

test('mock SSE rejects a clean transport close without end', async () => {
  const response = mockSse([
    'data: {"type":"source","source":[{"id":"candidate"}]}\n\n',
    'data: {"type":"answer","answer":"半成品"}\n\n',
  ]);
  await assert.rejects(collectLiveStream(response), /意外中断/);
});

test('mock SSE returns on end even when the connection stays open', async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const response = {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('data: {"type":"answer","answer":"完成"}\n\ndata: {"type":"end"}\n\n'));
      },
      cancel() { cancelled = true; },
    }),
  };
  assert.equal((await collectLiveStream(response, { timeoutMs: 50 })).answer, '完成');
  assert.equal(cancelled, true);
});

test('mock SSE times out when the reader stalls forever', async () => {
  const response = { body: new ReadableStream({ start() {} }) };
  await assert.rejects(collectLiveStream(response, { timeoutMs: 5 }), /等待超时/);
});

test('mock SSE propagates a reader failure', async () => {
  const response = {
    body: { getReader: () => ({
      read: () => Promise.reject(new Error('socket failed')),
      releaseLock() {},
    }) },
  };
  await assert.rejects(collectLiveStream(response), /socket failed/);
});

test('malformed data cannot be rescued by a later end event', async () => {
  const response = mockSse([
    'data: {"type":"answer","answer":"半截"}\n\ndata: not-json\n\ndata: {"type":"end"}\n\n',
  ]);
  await assert.rejects(collectLiveStream(response), /流格式异常/);
});
