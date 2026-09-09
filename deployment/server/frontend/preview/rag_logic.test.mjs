import assert from 'node:assert/strict';
import test from 'node:test';
import { filterAnswerSources, normalizeQuestion, resolveQuestion } from './shared/rag_logic.mjs';

test('live source filter uses exact chunk identifiers and nested sections', () => {
  const right = { title: 'policy.md', text: '质量问题退货运费\n平台承担' };
  const wrong = { title: 'policy.md', text: '非质量问题退货运费\n用户承担' };
  const nested = { title: 'policy.md', text: '正文', metadata: { section: '退款到账时效' } };
  assert.deepEqual(filterAnswerSources('来源：policy.md · 质量问题退货运费', [right, wrong]), [right]);
  assert.deepEqual(filterAnswerSources('来源：policy.md · 退款到账时效', [nested]), [nested]);
  assert.deepEqual(filterAnswerSources('来源：chunk-1', [{ id: 'chunk-10', text: '正文' }, { id: '   ', text: '' }]), []);
  assert.deepEqual(filterAnswerSources('来源：chunk-10', [{ id: 'chunk-10', text: '正文' }]).length, 1);
  assert.deepEqual(filterAnswerSources('当前知识库中未找到相关信息。建议联系人工客服确认。\n来源：policy.md · 质量问题退货运费', [right]), []);
});

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

test('RAG-02 historical semantic counterexamples keep negation and multi-intent boundaries', () => {
  const cases = [
    ['东西没有毛病，只是不喜欢，寄回去的钱谁出？', 'non_quality_shipping', /用户承担/, /平台承担|报销 12 元/],
    ['不是质量问题，是我买错了，快递费谁出？', 'non_quality_shipping', /用户承担/, /平台承担|报销 12 元/],
    ['商品没有质量问题，签收超过15天，寄回运费谁承担？', 'non_quality_shipping', /用户承担/, /平台承担|报销 12 元/],
    ['我没有要换货，只想问退款多久到银行卡？', 'refund_policy', /银行卡.*3—7 个工作日/, null],
  ];
  cases.forEach(([question, intent, expected, forbidden]) => {
    const result = resolveQuestion(question);
    const answer = result.sections.map((item) => item.text).join(' ');
    assert.equal(result.intent, intent, question);
    assert.match(answer, expected, question);
    if (forbidden) assert.doesNotMatch(answer, forbidden, question);
  });
});

test('RAG-02 historical compound questions answer each supported part explicitly', () => {
  const shippingAndRefund = resolveQuestion('质量问题退货运费谁出？另外银行卡退款一般多久到账？');
  assert.equal(shippingAndRefund.coverage.total, 2);
  assert.equal(shippingAndRefund.coverage.fullyAnswered, 2);
  assert.match(shippingAndRefund.sections.map((item) => item.text).join(' '), /12 元/);
  assert.match(shippingAndRefund.sections.map((item) => item.text).join(' '), /银行卡.*3—7 个工作日/);

  const evidenceAndShipping = resolveQuestion('质量问题退货需要哪些凭证，运费最高报销多少？');
  assert.equal(evidenceAndShipping.coverage.total, 2);
  assert.equal(evidenceAndShipping.coverage.fullyAnswered, 2);
  assert.match(evidenceAndShipping.sections.map((item) => item.text).join(' '), /照片|视频|检测说明/);
  assert.match(evidenceAndShipping.sections.map((item) => item.text).join(' '), /12 元/);
});

test('RAG-02 personal refund status wording refuses lookup without attaching policy evidence', () => {
  const result = resolveQuestion('退款是否已经到账？请查询我的账号。');
  assert.equal(result.intent, 'personal_data_unavailable');
  assert.equal(result.sources.length, 0);
  assert.match(result.sections[0].text, /无法访问|订单详情|人工客服/);
});

test('source filtering fails closed when the cited heading is ambiguous across files', () => {
  const answer = '按规则处理。\n来源：质量问题退货运费';
  const candidates = [
    { title: 'policy-a.md', text: '质量问题退货运费\n平台承担' },
    { title: 'policy-b.md', text: '质量问题退货运费\n商家承担' },
  ];
  assert.deepEqual(filterAnswerSources(answer, candidates), []);
  assert.deepEqual(filterAnswerSources('按规则处理。\n来源：policy-a.md · 质量问题退货运费', candidates), [candidates[0]]);
  assert.deepEqual(filterAnswerSources('按规则处理。\n来源：policy.md · 质量问题退货运费', [
    { title: 'policy.md', text: '质量问题退货运费\n候选 A' },
    { title: 'policy.md', text: '质量问题退货运费\n候选 B' },
  ]), []);
});

test('source filtering never combines a file on one citation line with a heading on another', () => {
  const candidates = [
    { title: 'policy-a.md', text: '重复章节\n候选 A' },
    { title: 'policy-b.md', text: '重复章节\n候选 B' },
  ];
  assert.deepEqual(filterAnswerSources('回答。\n来源：policy-a.md\n来源：重复章节', candidates), []);
});

test('a unique chunk id takes precedence over an ambiguous heading on the same citation line', () => {
  const candidates = [
    { id: 'chunk-a', title: 'policy.md', text: '重复章节\n候选 A' },
    { id: 'chunk-b', title: 'policy.md', text: '重复章节\n候选 B' },
  ];
  assert.deepEqual(filterAnswerSources('回答。\n来源：chunk-a · 重复章节', candidates), [candidates[0]]);
});
