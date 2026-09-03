# DocsGPT RAG 发布文件与安全清单

## 可发布内容

- 业务知识库、确定性评测脚本、脱敏后的公开结果与报告。
- `deployment/server/frontend/`、`overrides/`、公开 Compose、部署/检查脚本和 TLS 示例。
- 本地静态预览与自动化测试；页面必须继续标注静态预览不等于真实向量检索或 LLM。

## 仅留本地

- `.env`、`.demo-password`、`.demo-htpasswd`、共享 Agent token、数据库 dump 与 `data/`。
- `evaluation/results/` 中带会话 ID 的原始采集结果。
- Windows 绝对路径验证覆盖文件、临时 Dockerfile、用户测评简报和未定稿报告。

## 发布前门禁

1. 用 `sanitize_rag_results.py` 生成公开 JSONL，并确认不存在原始会话 ID 或密钥字段；允许保留布尔型 `conversation_id_redacted` 脱敏标记。
2. 确认 `DOCSGPT_AGENT_ID` 与 `DOCSGPT_SOURCE_ID` 只通过部署环境传入，SQL 和 Git 文件中没有写死实例 UUID。
3. 运行全部 Node、Python、30 条真实固定集与 6 条部署冒烟测试。
4. Compose 配置必须包含 Worker；后端 `7091` 只允许 Compose 内网访问。
5. 前端只绑定 `127.0.0.1:5173`，使用 HTTPS 反向代理、访问口令与 API 限流。
6. 正式回答只展示实际支撑答案的 Chunk；拒答必须为零 Sources。
7. `/demo`、`/ops/`、口语问法、边界问法和浏览器控制台全部通过后再更新公网链接。

访问口令是低频面试 Demo 的保护层，不等同于登录系统、RBAC 或生产级多租户安全。
