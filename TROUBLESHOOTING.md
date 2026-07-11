# 问题排查记录

## 1. Docker Desktop 提示 WSL not installed

现象：

```text
Docker Desktop - WSL not installed
```

处理方式：

1. 以管理员身份打开 PowerShell。
2. 执行：

```powershell
wsl --install
```

3. 安装完成后重启电脑。
4. 首次进入 Ubuntu 时创建 Linux 用户名和密码。
5. 重新启动 Docker Desktop。

## 2. setup.ps1 生成 INTERNAL_KEY 报错

现象：

```text
[System.Security.Cryptography.RandomNumberGenerator] 不包含名为 Fill 的方法
```

原因：

旧版 Windows PowerShell 对该方法支持不完整。

处理方式：

```powershell
$b = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
"INTERNAL_KEY=$(($b | ForEach-Object { $_.ToString('x2') }) -join '')" | Add-Content -Path .\.env -Encoding utf8
```

## 3. Alembic 数据库迁移冲突

现象：

```text
duplicate key value violates unique constraint "pg_type_typname_nsp_index"
Worker failed to boot
```

原因：

后端和 Worker 同时启动时，可能并发执行数据库初始化或迁移，导致冲突。

处理方式：

先清理并重新按顺序启动：

```powershell
docker compose --env-file .\.env -f .\deployment\docker-compose-hub.yaml down -v
docker compose --env-file .\.env -f .\deployment\docker-compose-hub.yaml up -d postgres redis
docker compose --env-file .\.env -f .\deployment\docker-compose-hub.yaml up backend
```

后端迁移完成后，再启动：

```powershell
docker compose --env-file .\.env -f .\deployment\docker-compose-hub.yaml up -d frontend worker
```

## 4. Select Model 无法选择模型

现象：

页面中模型下拉框为空或无法选择。

处理方式：

本 Demo 使用 DocsGPT Public API / local 默认配置时，可能不需要手动选择模型。只要后端能正常回答问题，就可以继续验证 RAG 问答链路。

## 5. Sources 已召回，但回答说“未找到相关信息”

现象：

页面显示 Sources 卡片中已经有正确知识片段，但 Answer 仍然回答：

```text
当前知识库中未找到相关信息
```

原因：

自定义 Prompt 未包含 DocsGPT 默认模板中的文档上下文注入逻辑，导致模型虽然检索到了文档，但生成阶段没有读取到 Sources 内容。

处理方式：

将 Agent 的 Prompt 改回 `default`，再重新开启一个新的 Agent 对话测试。

这个问题说明 RAG 系统需要同时关注：

- 知识库内容质量
- 检索召回结果
- Prompt 模板
- 生成阶段是否正确使用上下文

## 6. 回答中出现 Reasoning / thought 冗余文本

现象：

Answer 前面出现大量类似：

```text
{'type': 'thought', 'thought': ...}
```

处理方式：

这属于展示层或流式输出异常。用于截图展示时，可以重新开启新对话并使用简洁问题测试。如果最终答案正确且 Sources 可见，不影响项目核心闭环。

