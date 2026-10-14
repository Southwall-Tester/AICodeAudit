# Campus Market · 校园闲置集市

一个供阅读和接管练习的小型 FastAPI 项目：浏览商品、发布闲置、收藏商品。

这是明确标记的演示应用，使用内存存储和固定演示用户，不适合直接部署为真实交易平台。

启动：安装 `requirements.txt`，在本目录运行 `python -m uvicorn app:app --port 8001`，打开 http://127.0.0.1:8001 。

纯业务测试无需第三方依赖，在本目录运行 `python -m unittest discover -s tests -v`。

目录：`app.py` 装配 API；`services/items.py` 实现业务规则；`models/item.py` 定义数据；`web/` 提供前端；`tests/` 验证业务边界。
