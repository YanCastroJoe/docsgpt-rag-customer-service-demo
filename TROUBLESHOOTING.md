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

先停止服务并重新按顺序启动。只有确认可以永久删除当前 PostgreSQL、向量索引和容器卷数据时，才允许使用带 `-v` 的命令；该操作不可逆，不应作为普通重启步骤：

```powershell
docker compose --env-file .\.env -f .\deployment\docker-compose-hub.yaml down
docker compose --env-file .\.env -f .\deployment\docker-compose-hub.yaml up -d postgres redis
docker compose --env-file .\.env -f .\deployment\docker-compose-hub.yaml up backend
```

若数据库迁移冲突只能通过重建环境处理，请先备份所需数据，再显式执行 `down -v`。

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

原因：

本地模型的部分流式事件以 Python 字典文本形式进入了最终 `answer` 字段，数据库中也保存了该前缀。如果直接评分，会把传输/拼接异常误判成知识质量问题。

处理方式：

`run_docsgpt_evaluation.py` 只剥离回答开头、可由 `ast.literal_eval` 解析且 `type=thought` 的连续事件；普通正文中的类似字符串不会被修改。输出同时记录 `thought_events_stripped`，供人工复核，不能静默清洗。

## 7. PowerShell 请求导致中文问题变成问号

现象：

使用默认 `Invoke-RestMethod` 请求本地 `/api/answer` 时，数据库中的问题被保存为一串问号，模型因此给出“问题没有完整发送”的回答。

原因：

请求体字符编码没有被稳定地按 UTF-8 传递。

处理方式：

批量运行脚本使用：

```python
json.dumps(payload, ensure_ascii=False).encode("utf-8")
```

并发送 `Content-Type: application/json; charset=utf-8`。真实评测前先运行一条中文 smoke case，并到会话记录中核对问题内容。

## 8. 已拒答但继续输出无依据行业常识

现象：

V2 回答“知识库未提及人工客服服务时间”后，又补充“大多数平台通常为 9:00—22:00”等知识库外推测。

原因：

仅要求“未知时转人工”不足以限制模型继续补充自身知识；普通拒答命中规则也会漏掉这类边界泄漏。

处理方式：

1. 在 V3 知识库中明确禁止使用行业常识、其他平台经验和推测性内容；
2. 提供统一拒答模板；
3. 在评测集中增加 `forbidden_patterns`；
4. 先定向回归失败项，再执行完整 30 条回归，确认知识命中题没有退化。

