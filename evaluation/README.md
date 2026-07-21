# RAG 评测说明

本目录提供 30 条可复查的客服知识库评测用例：24 条知识命中题、6 条知识边界题。它用于检查三个基础维度：

- 回答是否覆盖知识库中的关键条件；
- 必答题是否带有正确的来源文件；
- 知识库未覆盖的问题是否明确转人工，而不是编造政策。

评测脚本不会请求模型或生成回答。请先在 DocsGPT Agent 中逐条提问，复制最终回答与页面显示的来源文件名，再填入 JSONL。这样才能确保简历、README 中出现的结果来自真实运行。

## 1. 校验评测集

```powershell
python scripts/evaluate_rag.py --validate-only
```

## 2. 生成回答导出模板

```powershell
python scripts/evaluate_rag.py --init-template evaluation/responses/run_2026xxxx.jsonl
```

每行填写一条真实回答，格式如下：

```json
{"case_id":"CS-001","answer":"非人为质量问题经审核通过后，平台承担往返运费；普通快递最高报销 12 元。","sources":["customer_service_rag_optimized.md"]}
```

`sources` 既可以是字符串数组，也可以是 DocsGPT API 导出的来源对象数组。文件名不必和用例中的提示完全一致，但应包含对应知识库文件名。

如果本机部署使用 PostgreSQL，可直接导出已完成会话中的真实回答；该脚本只读 `conversation_messages`，不读取 `.env`、不发送问题：

```powershell
python scripts/export_docsgpt_evaluation.py `
  --docsgpt-dir E:\codex\DocsGPT `
  --agent-id <Agent UUID> `
  --out evaluation/responses/run_2026xxxx.jsonl
```

使用 `--no-agent` 可只导出普通聊天中的结果；这适合与绑定 Agent 的优化版本做严格对比。

## 3. 生成报告

```powershell
python scripts/evaluate_rag.py `
  --responses evaluation/responses/run_2026xxxx.jsonl `
  --out evaluation/reports/run_2026xxxx.md `
  --summary-json evaluation/reports/run_2026xxxx.summary.json
```

报告会给出回答完整通过率、关键条件覆盖率、来源引用命中率和知识边界拒答率。不要在 README 或简历中填写未由报告验证过的百分比。

## 4. 做优化前后对比

建议先将 `customer_service_after_sales_policy.md`、`customer_service_product_membership.md` 和 `customer_service_faq.md` 作为“原始文档”运行一轮，再将 `customer_service_rag_optimized.md` 作为“FAQ 化知识库”运行一轮。两轮必须使用同一 Agent、同一模型、同一 Prompt 和本评测集。

```powershell
python scripts/compare_rag_runs.py `
  --baseline evaluation/reports/raw.summary.json `
  --candidate evaluation/reports/optimized.summary.json `
  --out evaluation/reports/raw_vs_optimized.md
```

对比脚本只读取两份真实的评测汇总文件，输出变化百分点；它不对缺失数据作推断。

## 判定边界

- 这是基础规则评测：正则表达式保证关键信息出现，不能完全替代人工的语义、语气与合规审查。
- 评分前应使用同一版本的知识库、Agent 和 Prompt；推荐使用 DocsGPT 默认 RAG Prompt。
- 当前项目没有保存生产用户数据，所有测试问题与客服政策均为 Demo 构造数据。
