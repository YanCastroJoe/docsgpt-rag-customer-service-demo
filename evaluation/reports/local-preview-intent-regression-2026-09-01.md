# DocsGPT RAG 本地预览意图回归报告

- 日期：2026-09-01
- 范围：`/preview/shared/` 静态产品预览与 `/ops/#live` 本地交互诊断
- 知识快照：`knowledge_base/customer_service_rag_optimized.md`
- 执行模式：`deterministic_local_preview`
- Query Rewrite：确定性同义词映射
- 检索参数：不适用；本轮未调用 DocsGPT API、向量库或 RRF
- Prompt 版本：不适用；本轮未调用 LLM Prompt

## 七条复测结果

| 用例 | 预期 | 结果 |
|---|---|---|
| RAG-01 能力范围 | `capability_scope`，说明可咨询与不可咨询范围 | 通过 |
| RAG-02 精确运费问法 | 返回平台承担条件、12 元上限和来源 | 通过 |
| RAG-03 口语同义问法 | 规范化为退货运费并命中同一知识 | 通过 |
| RAG-04 复合问题 | 拆分两个诉求，显示 2/2 覆盖与部分命中 | 通过 |
| RAG-05 业务越界 | `out_of_scope`，不再提示快递类型 | 通过 |
| RAG-06 模糊个人退款 | 先声明无法查询进度，再提供一般政策 | 通过 |
| RAG-07 明确订单查询 | `personal_data_unavailable`，不生成状态或来源 | 通过 |

## 自动化与浏览器验证

- Node 前端与规则测试：27/27 通过。
- 真实浏览器逐条提交上述 7 个问题：7/7 达到本地预览验收条件。
- 来源抽屉能够显示真实知识文件、章节和命中片段；未提供的 Chunk ID 与检索分数不补造。
- `/ops/#live` 能读取同源浏览器中的最近交互，显示 Request ID、原始问题、规范化问题、意图、子问题覆盖、拒答原因、最终回答与本地耗时。
- 页面控制台：无警告或错误。

## 边界

本报告不等同于 DocsGPT 后端 RAG 修复完成。原有 30 条真实 API 固定评测本轮没有重新运行；向量 Top K、关键词 Top K、RRF 排名、Prompt Sources 和 LLM 生成均未在静态预览中执行。因此不能用本报告宣称真实 API 的同义召回或复合问题能力已经修复，也不能覆盖原有真实 API 评测报告。
