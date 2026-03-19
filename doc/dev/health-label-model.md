# Pod 状态标签模型

状态标签用于替代仅依赖 STATUS 文本的风险判断，前端仅展示标签，不展示分值。

## 标签与分段

- 健康：90~100
- 关注：70~89
- 警告：40~69
- 严重：0~39

## 评分来源

初始分 100，按以下维度扣分：

- STATUS（如 CrashLoopBackOff、ImagePullBackOff、Unknown 等）
- READY（全就绪/部分就绪/全不就绪）
- RESTARTS（分档扣分）
- 长时间卡住（Pending/ContainerCreating/Terminating/Init:*）

## 输出字段

后端在 Pod 列表返回中附加：

- `healthLabel`
- `healthReasons`
- `healthScore`（内部可用）

## 设计原则

- 标签重在“风险可读性”
- reasons 重在“可解释性”
- 评分规则可迭代，但标签语义保持稳定

