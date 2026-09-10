# DSH AI Meter 实施计划

目标：为 DeepSeek Harness 提供统一的 AI 订阅额度、用量和余额中心；核心不依赖 DSH。

## v0.1 开发范围

1. TypeScript 核心：provider registry、多账号配置、不同单位的 meter、归一化、TTL 缓存、并发去重、独立错误状态、保留过期快照。
2. Adapters：OpenCode Go、MiniMax Token/Coding Plan、Codex app-server、Antigravity（official agy --print /usage text 桥接）、Kimi Coding、DeepSeek 余额、302.AI 余额。
3. DSH 集成：Cordis 服务 aiMeter、Typert RPC、Settings → AI Usage、query_ai_quota 工具。
4. UI：各账号周期与余额、重置时间、最低已知百分比、渠道/账号编辑、凭据来源与独立密钥写入、常驻 composer 按钮、自动刷新、过期与失败状态。
5. 渠道：本地发现候选、采集开关、预览开关、指标选择/别名/顺序/取值说明、Codex/AGY SSH CLI。SSH 尚需目标机器联调。
6. 路由准备：只读 getAvailableProviders，未知/过期数据不准入；不执行模型选择。
7. 质量：离线协议 fixture、缓存与错误场景、真实 Cordis 加载、浏览器 bundle 与打包校验，GitHub CI。

## 后续里程碑

- v0.2：原生 AGY 多账号 OAuth/keyring，Kimi OAuth 刷新，MiniMax/Kimi API 余额（先核实公开接口）。
- v0.3：SQLite 历史、通知、远端来源自动发现与账号关联去重。
- v0.4：按模型/池的路由策略，KORVIA ModelRouter 集成，独立核心包。

## 设计约束

- 不累计不同币种、不同窗口或不同 Provider 的额度。
- 不从未知值推断 0%、100% 或可用；余额没有分母时不制造百分比。
- 不把限流、凭据错误等同于额度耗尽。健康状态只描述当前采集结果，不代表厂商整体健康。
- 原始凭据不进入读取 RPC 响应、工具输出或日志；配置写入 RPC 允许提交新凭据但不回显；配置只存环境变量/DSH 凭据名称。
- 从上游获取数值，套餐价格及配额不硬编码。AGY pool 标明共享语义。
- 不复制现有项目整体架构；记录来源与依赖版本，协议变动用 fixture 捕获。

## 验收与发布

本地完成类型检查、测试、构建和 npm pack 校验。真实账号额度需用户环境联调，不能用模拟测试声称已验证。GitHub 推送、npm 发布及真实 DSH 安装另行记录。
