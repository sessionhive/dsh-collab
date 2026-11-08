# CHANGELOG · @sessionhive/dsh-collab

## 0.1.0 — 公开发布

> 早期内部迭代略过；本版为首个公开版本。

功能总览：
- 协作协议 v2：派单/接单/进度/提交/验收/关单/交接，flow 接力、refs 证据校验、状态机与 done-index。
- 工具面：wb_read（check/scene/order/board/search）、wb_write（note/progress/comment/task/submit/verify/reject/handoff/close/cancel/reopen，dryRun）、写时校验与 summary 投影。
- 看板：会话/在途/协作单/事件/学习/黑板/全局规则，链路抽屉、主题（auto/dark/light）、中英切换。
- 学习闭环：异常信号收集、分类、周报、命中率、观察期与限权注入（默认开启；`config.learn.autoApply=false` 可关闭，观察期机制保留）。
- 健壮性：refs 安全（相对 cwd 解析/防穿越/大小限制）、wake 重试+outbox、事件去重、plugin.log、manifest sha、schemaVersion 迁移。
- 设置页：会话协作（分组/技能/生命周期）、交接与工作区、其他设置（数据清理/日志/自检）。
- 自动索引：为核心功能，默认开启。
- 运行时数据 schemaVersion = 1。
