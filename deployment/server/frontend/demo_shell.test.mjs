import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('./demo-shell.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./demo-shell.css', import.meta.url), 'utf8');
const nginx = readFileSync(new URL('./nginx.conf', import.meta.url), 'utf8');

test('limits public demo behavior to shared Agent routes', () => {
  assert.match(shell, /pathname\.startsWith\('\/agents\/shared\/'\)/);
  assert.match(shell, /rag-public-demo/);
});

test('adds business identity, suggestions and diagnostics navigation', () => {
  assert.match(shell, /企业售后知识库 Agent/);
  assert.match(shell, /公开演示环境/);
  assert.match(shell, /dataset\.ragLegacyHeading/);
  assert.match(shell, /node\.children\.length === 0/);
  assert.match(shell, /常用问题/);
  assert.match(shell, /href="\/ops\/"/);
  assert.match(shell, /MutationObserver/);
});

test('public demo hides the upstream sidebar and releases main width', () => {
  assert.match(styles, /\[data-rag-sidebar\][\s\S]*display: none/);
  assert.match(styles, /\[data-rag-main\][\s\S]*margin-left: 0/);
});

test('nginx injects the public demo shell', () => {
  assert.match(nginx, /demo-shell\.css/);
  assert.match(nginx, /demo-shell\.js/);
});
