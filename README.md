# DocsGPT 企业知识库 RAG 智能客服 Demo

## 项目简介

本项目基于开源项目 [DocsGPT](https://github.com/arc53/DocsGPT) 进行本地部署与场景化配置，构建了一个面向电商售后业务的企业知识库 RAG 智能客服 Demo。系统支持上传业务文档，创建知识库 Source，配置专属 Agent，并基于检索到的文档片段生成可追溯回答。

本仓库不是 DocsGPT 源码的二次发布，而是一次面向实习求职展示的复现与应用实践记录，重点展示从部署、知识库构建、Agent 配置到问答验证的完整闭环。

## Demo 效果

### 1. 知识库 Source 管理

![知识库 Source 管理](screenshots/01_sources.png)

已上传并维护 `星禾优选客服知识库_RAG精简版`，作为 RAG 问答的数据来源。

### 2. Agent 配置

![Agent 配置](screenshots/02_agent_config.png)

创建 `企业知识库客服助手`，绑定企业客服知识库 Source，并使用 DocsGPT 默认 RAG Prompt。

### 3. RAG 问答效果

![RAG 问答效果](screenshots/03_rag_answer.png)

用户提出售后问题后，系统先召回相关 Sources，再生成带来源依据的回答。

## 核心能力

- 本地部署 DocsGPT，并通过 Docker Compose 启动前端、后端、Worker、PostgreSQL、Redis 等服务。
- 构建企业客服知识库，覆盖售后政策、会员权益、物流规则、积分和价保等场景。
- 创建并发布专属 Agent，将 Agent 与知识库 Source 绑定。
- 验证 RAG 问答链路：用户问题 -> 知识库检索 -> Sources 展示 -> 回答生成。
- 定位并修复一次真实 RAG 问题：检索结果已召回，但自定义 Prompt 未注入文档上下文，导致生成阶段未采纳 Sources。

## 项目结构

```text
.
├── README.md
├── docs/
│   └── DocsGPT_RAG智能客服项目展示_周彦辰.docx
├── knowledge_base/
│   ├── customer_service_after_sales_policy.md
│   ├── customer_service_product_membership.md
│   ├── customer_service_faq.md
│   └── customer_service_rag_optimized.md
├── screenshots/
│   ├── 01_sources.png
│   ├── 02_agent_config.png
│   └── 03_rag_answer.png
├── tests/
│   └── demo_test_questions.md
├── RUNBOOK.md
├── TROUBLESHOOTING.md
└── PROJECT_SUMMARY.md
```

## 知识库说明

`knowledge_base/` 中的文档是为 Demo 构造的企业客服样例知识库，包含：

- 售后政策：退换货规则、质量问题处理、运费承担、退款时效。
- 会员与商品规则：会员权益、积分规则、发货物流、价格保护。
- FAQ：客服高频问答。
- RAG 精简版：将高频问题整理成更适合检索召回的问答结构。

## 复现方式

详细步骤见 [RUNBOOK.md](RUNBOOK.md)。

简要流程：

1. 安装 Docker Desktop 与 WSL。
2. 克隆 DocsGPT 官方仓库。
3. 使用 Docker Compose 启动 DocsGPT。
4. 在 `Settings > Sources` 中上传知识库文档。
5. 在 `Manage Agents` 中创建 Agent，并绑定知识库 Source。
6. 使用 `tests/demo_test_questions.md` 中的问题进行验证。

## 测试问题示例

```text
质量问题退货运费谁承担？普通快递最高报销多少？请直接回答。
```

预期回答应包含：

- 非人为质量问题，经审核通过后，退货、换货或维修往返运费由平台承担。
- 用户自行寄回时，普通快递最高报销 12 元。
- 不建议到付，需保留快递单号。
- 回答应展示或引用相关 Sources。

## 项目复盘

本项目的一个关键排查点是：最初自定义 Prompt 后，页面能显示正确 Sources，但模型回答仍提示“知识库中未找到相关信息”。通过接口测试发现，检索层已经召回正确片段，但自定义 Prompt 没有包含 DocsGPT 默认模板中的文档上下文变量，导致生成阶段无法读取检索结果。最终切回默认 RAG Prompt 后，问答结果恢复正常。

这个问题体现了 RAG 系统中“检索正确不等于最终回答正确”，需要同时关注数据组织、召回效果、Prompt 模板和生成链路。


