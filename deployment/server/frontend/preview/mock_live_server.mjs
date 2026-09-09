import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('./shared/', import.meta.url)));
const port = Number(process.env.RAG_MOCK_PORT || 4173);
const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' };

function sendEvent(response, event) {
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (request.method === 'GET' && url.pathname === '/api/shared_agent') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ id: 'mock-agent', sources: ['mock-source'], chunks: 2 }));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/stream') {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => { body += chunk; });
    request.on('end', () => {
      let question;
      try { question = JSON.parse(body).question || ''; }
      catch { response.writeHead(400).end('invalid JSON'); return; }
      response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
      sendEvent(response, { type: 'source', source: [{ title: 'mock.md', text: '质量问题退货运费\n平台承担运费', id: 'chunk-1' }] });
      sendEvent(response, { type: 'answer', answer: '平台承担运费。\n来源：mock.md · 质量问题退货运费' });
      if (question.includes('显式错误')) sendEvent(response, { type: 'error', error: 'mock upstream failed' });
      else if (question.includes('坏帧')) response.write('data: not-json\n\n');
      else if (!question.includes('缺少结束')) sendEvent(response, { type: 'end' });
      response.end();
    });
    return;
  }

  const relative = url.pathname === '/' || url.pathname === '/demo/' ? 'index.html' : url.pathname.replace(/^\/demo\//, '');
  const file = resolve(root, relative);
  if (file !== root && !file.startsWith(`${root}${sep}`)) { response.writeHead(403).end(); return; }
  try {
    const content = readFileSync(file);
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' });
    response.end(relative === 'index.html'
      ? content.toString('utf8').replace('__SHARED_AGENT_TOKEN__', 'mock-token')
      : content);
  } catch {
    response.writeHead(404).end();
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`RAG mock live demo: http://127.0.0.1:${port}/demo/`);
});
