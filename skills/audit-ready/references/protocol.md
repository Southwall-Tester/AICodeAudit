# 交接协议 v1

位置：项目根目录 `.aicodeaudit/handoff.json`，UTF-8 JSON。所有路径相对于项目根目录，只能引用项目内文本文件；行号从 1 开始。

```json
{
  "version": 1,
  "project": {"name": "Project name", "summary": "项目用途与目标用户"},
  "start": [{"command": "python app.py", "cwd": ".", "note": "需要 Python 3.13"}],
  "features": [{
    "id": "create-item",
    "title": "创建条目",
    "summary": "输入标题，保存并返回条目编号。",
    "status": "implemented",
    "entrypoints": [{"path": "app.py", "line": 12}],
    "flow": [{"path": "app.py", "line": 12, "note": "观察请求校验与失败返回。"}],
    "acceptance": ["空标题应被拒绝"]
  }],
  "checks": [{
    "name": "创建条目测试",
    "command": "python -m unittest discover -s tests",
    "cwd": ".",
    "status": "not_run",
    "note": "尚未执行"
  }],
  "risks": [{"title": "暂未持久化", "detail": "数据仅保存在内存，进程退出后丢失。"}]
}
```

`project`、`features`、`checks`、`risks` 必填；空列表允许，不能为了填表虚构内容。`start` 可选。

引用对象为 `{path, line, sha256?, note?}`。运行校验器 `--stamp` 会以 UTF-8 解码（去 BOM）、将 CRLF / CR 换行归一化为 LF 后的文本内容计算 SHA-256，避免 Git 跨平台换行转换造成误报。没有指纹显示“未固定版本”；不匹配显示“源码已变化”；文件和行号存在、指纹匹配仅显示“引用匹配”。

`checks.status` 为 `passed`、`failed` 或 `not_run`。已运行的检查须额外提供 `exit_code`（整数）、`ran_at`（带时区的 ISO 8601 时间）和 `evidence`（引用对象）。`passed` 对应退出码 0，`failed` 对应非零。工具只检查记录结构、证据文件与指纹，不复跑命令，也不能确认记录真实。

`features.status` 为 `implemented`、`partial`、`planned`，均是作者声明。`implemented` 和 `partial` 至少提供一个源码入口。工作台不会将它自动转换成人工验收通过。

`flow` 是作者建议的阅读顺序，不是工具追踪到的运行轨迹。证据日志应短小，移除令牌、个人信息和本机绝对路径；不要引用 `.env` 或凭据文件。
