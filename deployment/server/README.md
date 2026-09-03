# 受限公网部署说明

本目录保存面试演示所需的公开配置、容器编排、前端外壳和检查脚本。它不是“从 GitHub 一键恢复完整 DocsGPT 实例”的发布包：数据库、向量索引、原始文件、密钥和共享 Agent token 均属于私有部署材料，不进入公开仓库。

## 私有前置材料

运行 `deploy-public-demos.sh` 前，运维者需要在服务器准备：

- `/tmp/docflow.tar.gz`：DocFlow 应用发布包。
- `/tmp/docsgpt-server.tar.gz`：DocsGPT 服务器发布包，解压后包含 `migration/indexes`、`migration/inputs`、`migration/vectors` 与 `migration/docsgpt-demo.dump`。
- `DOCFLOW_PUBLIC_URL`、`DOCSGPT_PUBLIC_URL`：已经规划的 HTTPS 域名。
- 部署脚本会把 `DOCSGPT_PUBLIC_URL` 写入前端构建配置，确保共享问答页连接当前部署的 API，而不是上游默认地址；前端网关同时转发 `/api/*` 与流式回答入口 `/stream`。
- `DOCSGPT_AGENT_ID`、`DOCSGPT_SOURCE_ID`：私有数据库恢复后对应的演示 Agent 与 Source UUID。

示例变量只用于说明，真实值不得提交 Git：

```bash
export DOCFLOW_PUBLIC_URL='https://docflow.example.com'
export DOCSGPT_PUBLIC_URL='https://rag.example.com'
export DOCSGPT_AGENT_ID='<restored-agent-uuid>'
export DOCSGPT_SOURCE_ID='<restored-source-uuid>'
```

脚本会在缺少任何必要归档或迁移材料时提前失败，并通过参数化 SQL 绑定指定 Agent 与 Source，不依赖仓库中写死的本机 UUID。

## 发布与验收

1. 使用 `Caddyfile.example` 或等价反向代理配置 TLS。
2. 运行 `deploy-public-demos.sh`，保存脚本生成的访问口令，不要复制到仓库或截图。
3. 在部署目录运行 `check-public-demos.sh`，确认业务页、诊断台、共享 Agent、2 个相关 Chunks、Worker 和容器健康状态全部通过。
4. 使用真实 DocsGPT API 重新执行 6 条部署冒烟测试；静态预览和历史 JSONL 不能替代这一步。

该方案仅用于脱敏、低频的面试演示，不提供完整登录、RBAC、多租户隔离、生产容量或 SLA 承诺。
