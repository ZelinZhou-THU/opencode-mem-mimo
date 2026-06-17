---
description: 从轨迹发现重复工作流并打包成 skill
agent: distill
subtask: true
---
<!-- opencode-mem-agent-v1 -->

分析近 30 天的工具使用模式。发现值得打包的重复工作流。

执行步骤：
1. 盘点已有的 skill，避免重复
2. 从记忆和轨迹中发现重复模式
3. 只在高置信度时创建 skill 到 `.opencode/skills/`
4. 如果没有真正重复的工作流，创建空结果也是有效的

$ARGUMENTS
