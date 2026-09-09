export function parseStreamFrame(frame, output) {
  const payloadText = frame
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n');
  if (!payloadText) return;

  let event;
  try { event = JSON.parse(payloadText); } catch { throw new Error('回答流格式异常，请稍后重试。'); }
  if (event.type === 'answer' && typeof event.answer === 'string') {
    if (!event.answer.includes("'type': 'thought'")) output.answer += event.answer;
  } else if (event.type === 'source' && Array.isArray(event.source)) {
    output.sources = event.source;
  } else if (event.type === 'end') {
    output.completed = true;
  } else if (event.type === 'error') {
    throw new Error(event.error || '回答生成失败');
  }
}

export function requireCompleteLiveOutput(output) {
  if (!output.completed) throw new Error('回答流意外中断，请稍后重试。');
  if (!output.answer.trim()) throw new Error('回答流已结束，但未生成有效回答。');
  return output;
}

export async function collectLiveStream(response, { timeoutMs = 120000 } = {}) {
  const output = { answer: '', sources: [], completed: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('回答流等待超时，请稍后重试。')), timeoutMs);
  });
  try {
    while (!output.completed) {
      const { value, done } = await Promise.race([reader.read(), timeout]);
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() || '';
      for (const frame of frames) {
        parseStreamFrame(frame, output);
        if (output.completed) break;
      }
      if (done) break;
    }
    if (!output.completed && buffer.trim()) parseStreamFrame(buffer, output);
    return requireCompleteLiveOutput(output);
  } finally {
    clearTimeout(timer);
    if (reader.cancel) await reader.cancel().catch(() => {});
    reader.releaseLock?.();
  }
}
