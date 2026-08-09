# 复现与运行手册

## 1. 环境准备

本 Demo 在 Windows 环境下完成复现，核心依赖如下：

- Windows 11
- WSL / Ubuntu
- Docker Desktop
- DocsGPT 官方仓库
- 浏览器访问地址：`http://localhost:5173`

## 2. 克隆 DocsGPT

```powershell
cd E:\codex
git clone https://github.com/arc53/DocsGPT.git
cd DocsGPT
```

如果已经手动下载 DocsGPT，只需进入项目目录即可。

## 3. 启动 Docker Desktop

确保 Docker Desktop 已启动，并且底部显示 Docker Engine 正常运行。

可在 PowerShell 中检查：

```powershell
docker --version
docker compose version
```

## 4. 生成内部密钥

如果 DocsGPT 的 `setup.ps1` 在 Windows PowerShell 中因为 `RandomNumberGenerator.Fill` 报错，可以使用兼容写法生成 `INTERNAL_KEY`：

```powershell
$b = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
"INTERNAL_KEY=$(($b | ForEach-Object { $_.ToString('x2') }) -join '')" | Add-Content -Path .\.env -Encoding utf8
```

## 5. 拉取镜像

```powershell
docker compose --env-file .\.env -f .\deployment\docker-compose-hub.yaml pull
```

## 5.1 使用本仓库一键启动脚本

如果已经完成上述首次配置，可回到本 Demo 仓库运行：

```powershell
.\start-demo.ps1 -DocsGPTPath "E:\codex\DocsGPT"
```

脚本会自动按依赖顺序启动容器并等待前后端就绪。面试前可执行：

```powershell
.\check-demo.ps1 -DocsGPTPath "E:\codex\DocsGPT"
```

看到 `[PASS]` 后再打开页面演示。路径仅为示例，可替换为实际 DocsGPT 目录，或通过 `DOCSGPT_HOME` 环境变量配置。

## 6. 推荐启动顺序

为避免数据库迁移并发冲突，建议先启动数据库和缓存：

```powershell
docker compose --env-file .\.env -f .\deployment\docker-compose-hub.yaml up -d postgres redis
```

然后启动后端，让它先完成数据库迁移：

```powershell
docker compose --env-file .\.env -f .\deployment\docker-compose-hub.yaml up backend
```

看到后端迁移完成并正常监听后，再打开一个新的 PowerShell，启动前端和 Worker：

```powershell
cd E:\codex\DocsGPT
docker compose --env-file .\.env -f .\deployment\docker-compose-hub.yaml up -d frontend worker
```

## 7. 访问页面

打开浏览器：

```text
http://localhost:5173
```

## 8. 上传知识库

进入：

```text
Settings > Sources > Add Source
```

建议上传：

```text
knowledge_base/customer_service_rag_optimized.md
```

如果想模拟更完整的企业知识库，也可以上传 `knowledge_base/` 下的所有 Markdown 文件。

## 9. 创建 Agent

进入：

```text
Manage Agents > New Agent > Classic Agent
```

推荐配置：

- Agent name：`企业知识库客服助手`
- Description：`基于企业售后政策、会员规则和客服 FAQ 构建的 RAG 智能客服助手`
- Source：选择上传后的客服知识库
- Prompt：`default`
- Agent type：`Classic`

注意：不要随意替换默认 Prompt。DocsGPT 默认 Prompt 内置了文档上下文注入逻辑，能让模型读取检索到的 Sources。

## 10. 验证问题

进入该 Agent 的新对话，输入：

```text
质量问题退货运费谁承担？普通快递最高报销多少？请直接回答。
```

预期答案：

- 平台承担非人为质量问题产生的退货、换货或维修往返运费。
- 用户自行寄回时，普通快递最高报销 12 元。
- 页面应显示 Sources 卡片或来源引用。

