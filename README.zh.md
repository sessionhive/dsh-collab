# dsh-collab（中文说明）

> **非 DeepSeek 官方项目**：这是社区插件，与 DeepSeek 官方无关。
> 英文主 README：[README.md](README.md)

**DSH 多会话协作插件：工单 + 交接 + 文件记忆。**

当你在 DSH 里同时用多个 AI 会话（命令 / 后端 / 测试）时，常见问题是：换会话就失忆、各写各的互相覆盖、谁在做什么没人知道。`dsh-collab` 把这些“口头协作”变成可追踪的小流程：

- **记忆在文件里，不在上下文里**：每个会话有身份卡、状态摘要、按日期的记忆；换会话不失忆。
- **写入走工具，不自由发挥**：`wb_read` / `wb_write` 校验每次写入（必须带来源、体量上限、只写自己目录），并自动刷新派生文件。
- **协作靠工单**：派单 → 转交 → 回执，一单到底；证据可核；看板显示每单在哪一棒。

## 功能

| 块 | 内容 |
|---|---|
| **工单** | `wb_write(task)` 建单；`flow` 决定接力顺序；`handoff` 交下一棒（可打回）；非最后一棒禁止关单；关单自动回执给主负责人 |
| **验收** | `verify` / `reject` 带证据；`close` 校验证据可达；记录各棒耗时/交接次数 |
| **记忆** | `note` 写按日期的记忆 + 自动投影 `summary.md`/`INDEX.md`；体量上限与轮转；`sessions.jsonl` 时间线（entry/handover/accept/end） |
| **会话生命周期** | 三态（在用/归档）、交接（接力 seed）、解绑、回收站、导出快照 |
| **看板** | 实时面板（会话/在途单/事件流/学习卡）、工单详情抽屉（完整链路）、日夜主题、中英切换 |
| **守卫** | 一任务一单（task_hash）、refs 安全（防 `..` 穿越/超限）、写入范围告警、stale 检测 + 重唤醒、wake 重试 |
| **学习** | 零 AI 信号采集（失败/超时/违规/反馈）、周报、看板学习卡；自动应用仅限插件默认项，可回退 |
| **可移植** | DSH 桌面版/Web 均可独立安装，无需外壳；`dataRoot` 配置；模板可在 `<dataRoot>/shared/templates/` 覆盖 |

## 安装

```bash
# 解压/安装到 DSH profile 的 node_modules，然后在 cordis.patch.yml 里加：
```
```yaml
- insert:
    - id: workbench-core
      name: dsh-workbench-core
      config:
        dataRoot: '/你的/.dsh/绝对路径'
```
重启 DSH → **设置 → 会话协作**。

## 工具面

| 工具 | 动作 |
|---|---|
| `wb_read` | `check` / `scene` / `order` / `board` / `search` |
| `wb_write` | `note` / `progress` / `comment` / `task` / `submit` / `verify` / `reject` / `handoff` / `close` / `cancel` / `reopen` |

## 30 秒理解

1. **主负责人**：谁接到需求谁负责，判断哪些自己做、哪些派出去（一单 flow）。
2. **接力**：`flow` 里的每一棒先 ack、再干活、然后 `handoff` 给下一棒；交接自动唤醒对方。
3. **回执与验收**：最后一棒交回主负责人；主负责人核证据（不重跑全套）、关单、交付。
4. **记忆**：结论落日期文件，summary/INDEX 是派生文件，新会话几秒接上。

## 文档

- `docs/`：使用手册、协议、验收清单
- `CHANGELOG.md`：公开版本历史（0.1.0 为首个公开版）

## 状态

`0.1.0` 首个公开版本。作者日常在用，但 API 与数据格式在 `1.0` 前仍可能调整。

## 许可

MIT
