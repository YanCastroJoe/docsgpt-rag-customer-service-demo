# DocsGPT RAG 智能客服面试演示手册

## 1. 项目边界

本仓库保存业务知识库、DocsGPT 配置与排障方法、真实 API 回答、离线评测脚本和结果；DocsGPT 官方源码与容器镜像不重复提交。演示时由本仓库脚本启动本机的 DocsGPT 官方目录。

## 2. 一键启动

先启动 Docker Desktop，再在本仓库根目录运行：

```powershell
.\start-demo.ps1 -DocsGPTPath "E:\codex\DocsGPT"
```

也可以提前设置环境变量，之后直接运行脚本：

```powershell
$env:DOCSGPT_HOME = "E:\codex\DocsGPT"
.\start-demo.ps1
```

脚本会按 PostgreSQL/Redis、后端、Worker、前端的顺序启动服务，等待健康检查通过，并自动打开 `http://127.0.0.1:5173`。

如不希望自动打开浏览器：

```powershell
.\start-demo.ps1 -DocsGPTPath "E:\codex\DocsGPT" -NoBrowser
```

## 3. 演示前自动检查

```powershell
.\check-demo.ps1 -DocsGPTPath "E:\codex\DocsGPT"
```

看到 `[PASS]` 表示前端、后端、Worker、PostgreSQL 和 Redis 均已运行。

## 4. 三分钟演示流程

### 场景与问题

电商客服需要根据内部售后政策回答问题。直接使用通用模型容易凭常识扩写；仅看到检索结果，也不能保证生成阶段真正使用了文档上下文。

### 操作

1. 在左侧选择 `企业知识库客服助手_V3`。
2. 输入标准问题：

```text
质量问题退货运费谁承担？普通快递最高报销多少？请直接回答。
```

3. 展示预期结果：平台承担符合条件的质量问题往返运费；自行寄回的普通快递最高报销 12 元；页面同时展示 `customer_service_rag_optimized.md` 来源。
4. 再输入知识边界问题：

```text
离我最近的线下维修门店在哪？
```

5. 展示预期结果：知识库没有门店信息时拒绝猜测，并建议联系人工客服确认。

### 重点讲解

- 真实问题不是“有没有召回”，而是自定义 Prompt 未注入文档上下文，导致生成阶段没有使用已召回 Sources；恢复默认 RAG 模板后链路正常。
- 通过 30 条固定用例记录回答、Sources、延迟和采集异常，再用失败分类定位 FAQ 覆盖缺口与无依据扩写。
- V3 同时补齐缺失政策、统一拒答模板，并禁止用行业常识补全未知信息；固定集端到端通过率由 96.7% 提升到 100%。该结果仅代表本次 30 条固定集，不外推为生产准确率。

### 面试收口

该项目的核心贡献是把开源 RAG 系统从“能够部署”推进到“问题可定位、效果可评测、版本可对比、知识边界可回归”，而不是宣称从零实现了 DocsGPT 或底层检索框架。

## 5. 演示前一分钟清单

- Docker Desktop 显示 Engine 正常运行。
- `.\check-demo.ps1` 输出 `[PASS]`。
- 左侧能看到 `企业知识库客服助手_V3`。
- 标准问题能出现答案和 Sources；边界问题能拒答。
- 不展示 `.env`、API Key、数据库密钥或本机私有配置。
