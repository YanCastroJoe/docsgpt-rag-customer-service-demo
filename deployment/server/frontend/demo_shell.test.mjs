import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('./demo-shell.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./demo-shell.css', import.meta.url), 'utf8');
const nginx = readFileSync(new URL('./nginx.conf', import.meta.url), 'utf8');

test('limits public product behavior to shared Agent routes', () => {
  assert.match(shell, /pathname\.startsWith\('\/agents\/shared\/'\)/);
  assert.match(shell, /rag-public-demo/);
});

test('adds customer-facing identity and common售后 questions', () => {
  assert.match(shell, /售后智能助手/);
  assert.match(shell, /退换货、退款与物流政策/);
  assert.match(shell, /暂时无法查询具体订单状态/);
  assert.match(shell, /服务正常/);
  assert.match(shell, /固定快照 2026-08-07/);
  assert.match(shell, /猜你想问/);
  assert.match(shell, /退货运费/);
  assert.match(shell, /退款时效/);
  assert.match(shell, /申请材料/);
  assert.match(shell, /href="\/ops\/">诊断台/);
  assert.match(shell, /fillQuestion/);
  assert.match(shell, /MutationObserver/);
  assert.match(shell, /HTMLTextAreaElement\.prototype/);
  assert.match(shell, /new InputEvent\('input'/);
});

test('keeps engineering narration out of the customer-facing shell', () => {
  assert.doesNotMatch(shell, /KNOWLEDGE HIT/);
  assert.doesNotMatch(shell, /ANSWER CHECK/);
  assert.doesNotMatch(shell, /DESIGN PRINCIPLE/);
  assert.doesNotMatch(shell, /评测与诊断/);
  assert.doesNotMatch(shell, /今天上海天气/);
});

test('styles a focused product surface with responsive suggestions', () => {
  assert.match(styles, /shared Agent is a customer-facing product surface/);
  assert.match(styles, /\.rag-suggestions/);
  assert.match(styles, /\.rag-suggestion-list/);
  assert.match(styles, /@media \(max-width: 700px\)/);
});

test('public demo hides the upstream sidebar and releases main width', () => {
  assert.match(styles, /\[data-rag-sidebar\][\s\S]*display: none/);
  assert.match(styles, /\[data-rag-main\][\s\S]*margin-left: 0/);
});

test('nginx injects the public product shell', () => {
  assert.match(nginx, /demo-shell\.css/);
  assert.match(nginx, /demo-shell\.js/);
});
