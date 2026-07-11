# GitHub 上传指南

## 1. 建议仓库名称

推荐使用：

```text
docsgpt-rag-customer-service-demo
```

也可以使用更简洁的：

```text
enterprise-rag-customer-service-demo
```

## 2. 仓库简介

GitHub 仓库 Description 可以填写：

```text
基于 DocsGPT 复现的企业知识库 RAG 智能客服 Demo，支持知识库 Source、Agent 配置、Sources 召回与可追溯问答展示。
```

## 3. 推荐 Topics

```text
rag
llm
docsgpt
knowledge-base
customer-service
ai-agent
docker
```

## 4. 上传方式一：网页上传

适合第一次操作 GitHub 的情况。

1. 打开 GitHub。
2. 点击右上角 `+`，选择 `New repository`。
3. Repository name 填写 `docsgpt-rag-customer-service-demo`。
4. 选择 `Public`。
5. 不要勾选自动创建 README，因为本项目已经有 README。
6. 创建仓库后，点击 `uploading an existing file`。
7. 将本目录下所有文件和文件夹拖入页面。
8. Commit message 填写：

```text
init DocsGPT RAG customer service demo
```

9. 点击 `Commit changes`。

## 5. 上传方式二：命令行上传

如果已经安装 Git，可以在本项目目录执行：

```powershell
git init
git add .
git commit -m "init DocsGPT RAG customer service demo"
git branch -M main
git remote add origin https://github.com/你的用户名/docsgpt-rag-customer-service-demo.git
git push -u origin main
```

注意将 `你的用户名` 替换成自己的 GitHub 用户名。

## 6. 上传后检查

上传完成后，检查以下内容：

- README 首页是否能正常显示三张截图。
- `knowledge_base/` 是否包含知识库样例文档。
- `docs/` 中是否包含项目展示 Word 文档。
- `tests/demo_test_questions.md` 是否能打开。
- README 中的图片路径是否正常。

## 7. 简历链接写法

简历中可以写：

```text
项目链接：https://github.com/你的用户名/docsgpt-rag-customer-service-demo
```

项目名称建议写：

```text
DocsGPT 企业知识库 RAG 智能客服 Demo
```

