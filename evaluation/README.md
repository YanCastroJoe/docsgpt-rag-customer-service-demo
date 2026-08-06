# RAG 评测说明

本目录提供 30 条可复查的客服知识库评测用例：24 条知识命中题、6 条知识边界题。它用于检查以下维度：

- 回答是否覆盖知识库中的关键条件；
- 必答题是否带有预期来源文件；
- 知识库未覆盖的问题是否明确转人工；
- 拒答后是否继续追加行业常识或其他无依据内容；
- 端到端通过率、逐条延迟与采集异常。

`run_docsgpt_evaluation.py` 负责调用本地 DocsGPT Agent；`evaluate_rag.py` 只做确定性离线评分，不请求模型或生成答案。每条结果都保留会话 ID、Sources、延迟和采集诊断，确保 README 与简历指标可以追溯到真实运行。

## 1. 校验评测集

```powershell
python scripts/evaluate_rag.py --validate-only
```

## 2. 运行真实 Agent 评测

```powershell
$env:DOCSGPT_AGENT_API_KEY = "<本地 Agent API Key>"
python scripts/run_docsgpt_evaluation.py `
  --out evaluation/responses/run_2026xxxx.jsonl
```

API Key 只从环境变量读取，不会写入输出。脚本行为：

- 每个用例新建独立隐藏会话，避免上下文串扰；
- JSON 请求显式使用 UTF-8；
- 每条完成后立即落盘，中断后使用同一 `--out` 自动续跑；
- 保存回答、来源文件、会话 ID、耗时和采集清洗标记。

也可以只运行指定用例做定向回归：

```powershell
python scripts/run_docsgpt_evaluation.py `
  --out evaluation/responses/run_2026xxxx.jsonl `
  --case-id CS-029
```

每行格式示例：

```json
{"case_id":"CS-001","answer":"非人为质量问题经审核通过后，平台承担往返运费；普通快递最高报销 12 元。","sources":["customer_service_rag_optimized.md"],"conversation_id":"...","latency_ms":8430,"response_encoding_repaired":false,"thought_events_stripped":0}
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

报告会给出回答完整通过率、关键条件覆盖率、来源文件命中率、知识边界拒答率、端到端通过率、失败分类和延迟分位数。不要在 README 或简历中填写未由报告验证过的百分比。

## 4. 做多版本对比

建议先将 `customer_service_after_sales_policy.md`、`customer_service_product_membership.md` 和 `customer_service_faq.md` 作为“原始文档”运行一轮，再将 `customer_service_rag_optimized.md` 作为“FAQ 化知识库”运行一轮。两轮必须使用同一 Agent、同一模型、同一 Prompt 和本评测集。

```powershell
python scripts/compare_rag_runs.py `
  --run "原始版=evaluation/reports/raw.summary.json" `
  --run "FAQ版=evaluation/reports/optimized.summary.json" `
  --run "V3=evaluation/reports/v3.summary.json" `
  --out evaluation/reports/version_comparison.md
```

对比脚本支持两个或更多版本，并输出指标与失败症状分布；它不对缺失数据作推断。历史运行配置见 `run_manifest.json`。

## 失败分类

- `answer_condition_miss`：知识命中题缺少必答条件；
- `unexpected_abstention`：知识库已有答案，但模型错误转人工；
- `source_citation_miss`：未命中预期来源文件；
- `boundary_refusal_miss`：知识边界题未明确拒答；
- `unsupported_boundary_claim`：虽然声明知识库未覆盖，但继续输出无依据推测；
- `missing_response` / `empty_answer`：回答缺失或为空。

这些标签描述可观察症状，不自动推断根因。知识缺失、检索失败、Prompt 上下文丢失等根因仍需结合 Sources 和运行记录人工复核。

## 判定边界

- 这是基础规则评测：正则表达式保证关键信息出现，不能完全替代人工的语义、语气与合规审查。
- 评分前应使用同一版本的知识库、Agent 和 Prompt；推荐使用 DocsGPT 默认 RAG Prompt。
- 当前项目没有保存生产用户数据，所有测试问题与客服政策均为 Demo 构造数据。
- 固定 30 条回归集上的 100% 不能外推为生产准确率；需要扩大难例、做多轮随机性测试和人工抽检。
