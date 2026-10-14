# AICodeAudit

**理解、审查并接管 AI 从零生成的项目。**

两个配套产品放在同一个仓库：

1. **项目理解与审查工作台**：读取真实源码，展示职责地图、功能入口、阅读路线、源码证据和个人笔记。
2. **Audit-ready Skill**：让生成代码的 AI 同步交付结构化交接包；工作台检查声明引用是否对应当前源码。

## 启动

需要 **Python 3.12+**。工作台运行仅使用 Python 标准库，不需要安装 npm 包、数据库服务或配置 API Key。

```powershell
python -m audit.server
```

Windows 也可双击仓库中的 `start.bat`。在浏览器打开 **http://127.0.0.1:8765**。

端口占用时：`python -m audit.server --port 8766`。关闭终端或按 Ctrl+C 停止服务。

点击「探索示例项目」体验完整流程；点击「导入项目」输入本机目录，或从文件选择器导入文件夹。导入只读取项目，不运行其中的脚本或安装依赖。

本地索引、源码快照、阅读记录：`.local/workbench.sqlite3`。错误日志：`.local/server.log`。这些数据已被 Git 忽略。

## 工作台功能

| 入口 | 实际能力 |
| --- | --- |
| 项目概览 | README 摘要、语言及文件统计、候选启动入口、阅读进度 |
| 架构地图 | 按文件职责启发式分组；根据已解析导入绘制跨组关系；点击查看源码 |
| 功能探索 | 读取交接包中的功能与阅读步骤；提取常见 Python / JS 路由入口；保存独立的人工审查结论和依据 |
| 阅读路线 | 根据 README、入口、导入关联、模型、界面和测试生成建议路线 |
| 源码浏览 | 文件与符号筛选、按行定位、关联文件、笔记和已读状态 |
| 交接与审查 | 交接包结构与源码指纹检查、待完成标记、生成方检查记录与已知限制 |
| 项目问答 | 无 Key 时提供本地检索；可选模型基于检索片段解释，附独立源码链接 |
| 报告导出 | 导出 Markdown 接管报告，包含当前快照、阅读记录与未确认事项 |

重新索引后，只有内容完全相同的快照沿用已读记录；变化后的项目需重新核对，旧记录仍保存在数据库。移除项目索引会删除工作台中的源码快照与阅读记录，不删除原项目。

## 生成端 Skill

入口：[skills/audit-ready/SKILL.md](skills/audit-ready/SKILL.md)。它是可独立分发的文件夹，包含说明、协议与标准库校验器。

将 `skills/audit-ready` 复制到所用 AI 工具支持的 Skills 目录，或直接让 AI 阅读 `SKILL.md`。不依赖自动安装。

推荐提示词：

> 使用 $audit-ready 完成这个项目，交付代码、启动说明，以及 .aicodeaudit/handoff.json。未运行的检查请明确标记。

交接包协议：[protocol.md](skills/audit-ready/references/protocol.md)。完整例子：[示例交接包](examples/campus-market/.aicodeaudit/handoff.json)。

```powershell
# 对当前引用写入内容指纹；不证明功能正确
python skills/audit-ready/scripts/validate_handoff.py path/to/project --stamp

# 只校验，不修改
python skills/audit-ready/scripts/validate_handoff.py path/to/project
```

工作台将**生成方声明、引用匹配、人工阅读记录**分别呈现。日志与退出码是作者交付的证据，工作台不会自动执行它们，也不能仅凭文件存在确认测试真实性。

## 可选模型

在「模型设置」填写完整 Chat Completions 格式接口地址、模型 ID 和 Key。本地模型可以不填 Key。问答时勾选「使用已配置模型」才发送问题和相关源码片段。

设置仅在进程内保存，也支持环境变量 `AUDIT_LLM_ENDPOINT`、`AUDIT_LLM_MODEL`、`AUDIT_LLM_KEY`。接口应返回 `choices[0].message.content`。远程地址要求 HTTPS，本地模型支持 HTTP。问答不是可自主运行命令的 Agent。

## 适用范围与边界

- Python 使用 AST 提取函数、类、导入和常见路由装饰器；JS/TS 为启发式提取，复杂语法、动态导入、别名、框架隐式路由可能遗漏。其他已支持扩展名的语言提供文本索引与搜索。
- 地图表示**静态导入关系**，功能交接步骤表示**作者建议阅读顺序**，均不是实际运行调用链。
- 文件职责来自路径规则；候选入口、待完成标记和关键词检索不是全项目语义分析或全面安全审计。
- 默认跳过常见凭据文件、依赖和构建目录；本机路径导入支持基础 `.gitignore` 匹配，不支持否定规则。浏览器导入采用固定排除规则，不应用 `.gitignore`。
- 最多 1500 个文件、12 MB 文本、单文件 350 KB。跳过数量和解析限制在「交接与审查」中显示。源码中硬编码的密钥不会被完备识别，启用远程模型前应检查发送范围。
- 服务绑定本机回环地址，验证 Host / Origin；没有多用户鉴权，不作为互联网服务部署。

## 开发与测试

```powershell
python -X utf8 -m unittest discover -s tests -v
node --check web/app.js

# 可选开发依赖（Node 24.15+）：真实 DOM + 本地 API 联调，不是运行工作台所需
npm ci --ignore-scripts
npm test
```

生成端 Skill 可独立运行校验器。示例业务测试在 `examples/campus-market` 目录执行 `python -m unittest discover -s tests -v`。

产品调研与取舍：[docs/research.md](docs/research.md)。架构与验收：[docs/architecture.md](docs/architecture.md)。
