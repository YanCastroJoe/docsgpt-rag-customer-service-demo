export const TRACE_STORAGE_KEY = 'docsgpt_rag_preview_traces_v2';

const FILE = 'customer_service_rag_optimized.md';

export const sources = {
  shipping: {
    id: 'shipping-policy',
    file: FILE,
    section: '质量问题退货运费',
    snippet: '非人为质量问题在签收后 15 日内提交申请且凭证审核通过时，往返运费由平台承担；普通快递最高报销 12 元。',
    location: '## 质量问题退货运费',
  },
  nonQualityShipping: {
    id: 'non-quality-shipping',
    file: FILE,
    section: '非质量问题退货运费',
    snippet: '非质量问题退货由用户承担寄回运费；商品需保持包装、配件、赠品和说明书完整，不影响二次销售。',
    location: '## 非质量问题退货运费',
  },
  deadline: {
    id: 'after-sales-deadline',
    file: FILE,
    section: '质量问题售后流程',
    snippet: '用户需要在签收后 15 日内提交售后申请，并上传清晰照片、视频或检测说明。',
    location: '## 质量问题售后流程',
  },
  refund: {
    id: 'refund-timing',
    file: FILE,
    section: '退款到账时效',
    snippet: '普通商品质检为 1—3 个工作日；微信、支付宝退款通常 1—3 个工作日到账，银行卡通常 3—7 个工作日到账。',
    location: '## 退款到账时效',
  },
  exchange: {
    id: 'exchange-stock',
    file: FILE,
    section: '换货缺货处理',
    snippet: '同款商品缺货时，客服提供退款或更换同价商品两种方案，由用户确认后处理。',
    location: '## 换货缺货处理',
  },
  evidence: {
    id: 'quality-evidence',
    file: FILE,
    section: '质量问题售后流程',
    snippet: '质量问题售后申请需上传清晰照片、视频或检测说明。',
    location: '## 质量问题售后流程',
  },
};

const synonymRules = [
  [/寄回去的钱|寄回的钱|寄件费用|寄回费用|寄回商品的快递费|寄回快递费|快递费|邮寄费|邮费/g, '退货运费'],
  [/东西坏了|商品坏了|商品有问题|收到的商品有质量问题|有毛病|出毛病|用不了|有故障/g, '商品质量问题'],
  [/最多给报多少|最多能报多少|最多报多少|报销上限/g, '最高报销多少'],
  [/多久到账|什么时候到账/g, '退款到账时效'],
];

export function normalizeQuestion(question) {
  let normalized = String(question || '').trim().replace(/\s+/g, ' ');
  synonymRules.forEach(([pattern, replacement]) => { normalized = normalized.replace(pattern, replacement); });
  return normalized;
}

export function classifyIntent(question, normalized = normalizeQuestion(question)) {
  const original = String(question || '');
  if (/(可以问(任何|什么)|能问什么|你能做什么|能力范围|支持哪些问题)/.test(original)) return 'capability_scope';
  if (/(推荐|选购|哪款).*(手机|电脑|商品)|帮我.*(买|挑)/.test(original)) return 'out_of_scope';
  if (/(海外|国际|线下维修门店|永久免费维修|24\s*小时.*人工客服)/.test(original)) return 'knowledge_not_found';
  if (/(订单\s*\d+|订单号|查询订单|查.*订单|这单.*(退没退|进度)|退款.*(到哪一步|进度)|订单状态|实时物流|退款到账了吗)/.test(original)) return 'personal_data_unavailable';
  if (/(我的退款|我这笔退款).*(什么时候|多久|到账|时效)/.test(original)) return 'refund_policy_with_personal_disclaimer';
  if (/换货|缺货/.test(normalized) && /退款/.test(normalized) && /(时效|多久|到账)/.test(normalized)) return 'compound_policy';
  if (/(超过|超出).{0,4}(15|十五).{0,2}(天|日)/.test(original) && /运费|邮费|寄回/.test(original)) return 'compound_after_sales';
  if (/退货运费|运费/.test(normalized) && /(没有质量问题|非质量问题|不想要|个人原因)/.test(normalized)) return 'non_quality_shipping';
  if (/退货运费|运费/.test(normalized) && /质量问题/.test(normalized)) return 'shipping_policy';
  if (/退款/.test(normalized) && /(时效|多久|到账)/.test(normalized)) return 'refund_policy';
  if (/缺货|换货/.test(normalized)) return 'exchange_policy';
  if (/凭证|证明|材料/.test(normalized)) return 'evidence_policy';
  return 'knowledge_not_found';
}

const section = (title, text, sourceIds = []) => ({ title, text, sourceIds });
const sub = (label, status, note) => ({ label, status, note });

export function resolveQuestion(question) {
  const originalQuestion = String(question || '').trim();
  const normalizedQuestion = normalizeQuestion(originalQuestion);
  const intent = classifyIntent(originalQuestion, normalizedQuestion);
  const base = {
    originalQuestion,
    normalizedQuestion,
    intent,
    refusalReason: null,
    sections: [],
    sources: [],
    subQuestions: [],
    coverage: { handled: 1, total: 1, fullyAnswered: 1, status: 'complete' },
    generationMode: 'deterministic_local_preview',
  };

  if (intent === 'capability_scope') return {
    ...base,
    headline: '我能帮助你了解售后政策',
    sections: [section('可以咨询', '退换货、退款到账规则、质量问题、换货、发货与物流政策。'), section('暂不支持', '无法查询个人订单、真实退款进度或实时物流，也不回答与售后无关的问题。')],
    refusalReason: 'capability_scope',
  };
  if (intent === 'out_of_scope') return {
    ...base,
    headline: '这个问题不在售后助手的服务范围内',
    sections: [section('服务边界', '我只回答退换货、退款和物流等售后政策，不能提供商品选购或推荐。你可以继续咨询具体售后规则。')],
    refusalReason: 'out_of_scope',
    coverage: { handled: 1, total: 1, fullyAnswered: 0, status: 'refused' },
  };
  if (intent === 'personal_data_unavailable') return {
    ...base,
    headline: '我无法查询你的实际订单进度',
    sections: [section('查询路径', '这个助手无法访问个人订单、退款进度或实时物流。请前往订单详情查看，或联系人工客服。')],
    refusalReason: 'personal_data_unavailable',
    coverage: { handled: 1, total: 1, fullyAnswered: 0, status: 'refused' },
  };
  if (intent === 'refund_policy_with_personal_disclaimer') return {
    ...base,
    headline: '我无法查询实际进度，但可以说明一般退款时效',
    sections: [
      section('你的订单', '我无法访问你的订单，因此不能判断这笔退款当前进行到哪一步。'),
      section('一般政策', '普通商品质检通常需要 1—3 个工作日；质检完成后，微信或支付宝退款通常 1—3 个工作日到账，银行卡通常 3—7 个工作日到账。', ['refund-timing']),
      section('查询当前状态', '请前往订单详情查看，或联系人工客服。'),
    ],
    sources: [sources.refund],
    refusalReason: 'personal_data_unavailable_with_policy',
  };
  if (intent === 'compound_after_sales') return {
    ...base,
    headline: '这个问题包含两个诉求，我分别回答',
    sections: [
      section('1. 超过 15 天能否退货', '知识库只明确规定质量问题需要在签收后 15 日内提交售后申请，没有说明超过 15 日后的例外处理。该情况需要联系人工客服确认。', ['after-sales-deadline']),
      section('2. 退货运费由谁承担', '非人为质量问题在规定时间内提交申请且凭证审核通过后，往返运费由平台承担；自行寄回的普通快递最高报销 12 元。', ['shipping-policy']),
    ],
    sources: [sources.deadline, sources.shipping],
    subQuestions: [
      sub('超过 15 天能否退货', 'not_covered', '知识库未说明超过期限后的例外处理'),
      sub('质量问题退货运费由谁承担', 'answered', '已命中运费规则'),
    ],
    coverage: { handled: 2, total: 2, fullyAnswered: 1, status: 'partial_answer' },
    refusalReason: 'partial_answer',
  };
  if (intent === 'compound_policy') return {
    ...base,
    headline: '我把两个售后问题分别说明',
    sections: [
      section('1. 换货缺货', '同款商品缺货时，客服会提供退款或更换同价商品两种方案，由用户确认后处理。', ['exchange-stock']),
      section('2. 退款到账', '普通商品质检通常需要 1—3 个工作日；质检完成后，微信或支付宝通常 1—3 个工作日到账，银行卡通常 3—7 个工作日到账。', ['refund-timing']),
    ],
    sources: [sources.exchange, sources.refund],
    subQuestions: [
      sub('换货缺货怎么办', 'answered', '已命中换货缺货规则'),
      sub('退款多久到账', 'answered', '已命中退款到账时效'),
    ],
    coverage: { handled: 2, total: 2, fullyAnswered: 2, status: 'complete' },
  };
  if (intent === 'non_quality_shipping') return {
    ...base,
    headline: '非质量问题退货运费规则',
    sections: [section('用户承担寄回运费', '不想要、个人原因等非质量问题退货，由用户承担寄回运费；商品需保持外包装、配件、赠品和说明书完整，不影响二次销售。', ['non-quality-shipping'])],
    sources: [sources.nonQualityShipping],
  };
  if (intent === 'shipping_policy') return {
    ...base,
    headline: '质量问题退货运费规则',
    sections: [section('平台承担条件', '商品属于非人为质量问题，并在签收后 15 日内提交申请且凭证审核通过时，退货、换货或维修产生的往返运费由平台承担。', ['shipping-policy']), section('自行寄回', '普通快递运费最高报销 12 元；偏远地区和大件商品需由客服单独确认。', ['shipping-policy'])],
    sources: [sources.shipping],
  };
  if (intent === 'refund_policy') return {
    ...base,
    headline: '一般退款时效',
    sections: [section('处理时间', '普通商品质检通常需要 1—3 个工作日。质检完成后，微信或支付宝退款通常 1—3 个工作日到账，银行卡通常 3—7 个工作日到账。', ['refund-timing'])],
    sources: [sources.refund],
  };
  if (intent === 'exchange_policy') return { ...base, headline: '换货缺货处理', sections: [section('可选方案', '同款商品缺货时，客服会提供退款或更换同价商品两种方案，由用户确认后处理。', ['exchange-stock'])], sources: [sources.exchange] };
  if (intent === 'evidence_policy') return { ...base, headline: '质量问题申请材料', sections: [section('需要提供', '请上传能够清楚展示问题的照片、视频或检测说明，客服会根据凭证判断后续处理方案。', ['quality-evidence'])], sources: [sources.evidence] };
  return {
    ...base,
    headline: '当前知识库没有覆盖这个问题',
    sections: [section('下一步', '我不会根据外部常识猜测答案。你可以补充与售后相关的商品情况和具体诉求，或联系人工客服确认。')],
    refusalReason: 'knowledge_not_found',
    coverage: { handled: 1, total: 1, fullyAnswered: 0, status: 'not_covered' },
  };
}

export function buildTrace(result, durationMs, requestId) {
  return {
    request_id: requestId,
    created_at: new Date().toISOString(),
    original_question: result.originalQuestion,
    intent: result.intent,
    normalized_question: result.normalizedQuestion,
    sub_questions: result.subQuestions,
    retrieval: {
      mode: 'deterministic_local_preview',
      keyword_hits: result.sources.map((item) => item.section),
      vector_top_k: null,
      rrf_ranking: null,
      prompt_sources: [],
      note: '本地静态预览未调用向量库或 LLM Prompt；仅记录确定性规则命中。',
    },
    sources: result.sources,
    refusal_reason: result.refusalReason,
    coverage: result.coverage,
    final_answer: result.sections.map((item) => `${item.title}：${item.text}`).join('\n'),
    duration_ms: durationMs,
  };
}
