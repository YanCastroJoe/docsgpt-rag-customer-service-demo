import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeQuestion, resolveQuestion } from './shared/rag_logic.mjs';

test('RAG-01 capability questions bypass knowledge-not-found recovery', () => {
  const result = resolveQuestion('我可以问任何问题吗？');
  assert.equal(result.intent, 'capability_scope');
  assert.match(result.sections.map((item) => item.text).join(' '), /退换货.*退款.*物流/);
  assert.doesNotMatch(result.headline, /没有覆盖|没有找到/);
});

test('RAG-02 exact shipping question keeps policy conditions and source', () => {
  const result = resolveQuestion('质量问题退货时，运费由谁承担？');
  const answer = result.sections.map((item) => item.text).join(' ');
  assert.equal(result.intent, 'shipping_policy');
  assert.match(answer, /平台承担/);
  assert.match(answer, /12 元/);
  assert.equal(result.sources[0].section, '质量问题退货运费');
});

test('RAG-03 colloquial shipping wording is normalized to the same intent', () => {
  assert.match(normalizeQuestion('收到的商品有质量问题，寄回去的钱需要我出吗？'), /退货运费/);
  const result = resolveQuestion('收到的商品有质量问题，寄回去的钱需要我出吗？');
  assert.equal(result.intent, 'shipping_policy');
  assert.equal(result.sources[0].id, 'shipping-policy');
});

test('RAG-04 compound question reports both subquestions and partial coverage', () => {
  const result = resolveQuestion('商品有质量问题，签收超过15天还能退吗？运费谁承担？');
  assert.equal(result.intent, 'compound_after_sales');
  assert.equal(result.subQuestions.length, 2);
  assert.equal(result.coverage.handled, 2);
  assert.equal(result.coverage.status, 'partial_answer');
  assert.match(result.sections[0].text, /没有说明超过 15 日后的例外处理/);
  assert.match(result.sections[1].text, /平台承担/);
});

test('RAG-05 out-of-scope request gets relevant guidance only', () => {
  const result = resolveQuestion('帮我推荐一款手机。');
  const answer = result.sections.map((item) => item.text).join(' ');
  assert.equal(result.intent, 'out_of_scope');
  assert.match(answer, /售后政策/);
  assert.doesNotMatch(answer, /快递类型/);
});

test('RAG-06 ambiguous personal refund asks disclaim before policy', () => {
  const result = resolveQuestion('我的退款什么时候到账？');
  assert.equal(result.intent, 'refund_policy_with_personal_disclaimer');
  assert.match(result.sections[0].text, /无法访问你的订单/);
  assert.match(result.sections[1].text, /1—3 个工作日/);
  assert.equal(result.sources[0].id, 'refund-timing');
});

test('RAG-07 explicit order lookup never invents status or source', () => {
  const result = resolveQuestion('请帮我查询订单123456现在退款到哪一步了。');
  assert.equal(result.intent, 'personal_data_unavailable');
  assert.equal(result.sources.length, 0);
  assert.match(result.sections[0].text, /订单详情|人工客服/);
});
