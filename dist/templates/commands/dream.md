---
description: 整合项目记忆和轨迹到 MEMORY.md
agent: dream
subtask: true
---
<!-- opencode-mem-agent-v1 -->

整合所有项目记忆和近 7 天的会话轨迹到 `.opencode/MEMORY.md`。

执行步骤：
1. 搜索 opencode-mem 记忆库中的所有项目记忆
2. 用 sqlite3 查询 opencode.db 验证候选事实
3. 合并重复条目，删除过时信息
4. 保持 MEMORY.md 在 200 行 / 10KB 以内

$ARGUMENTS
