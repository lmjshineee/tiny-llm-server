# 实验手册：用这个 Lab 学会“解释现象”

> 所有实验默认使用**模拟数据**。不要把这些数字写成硬件实测。
> 每个实验只改一个变量；先写预测，再跑，再解释。

---

## 0. 实验记录格式

每次实验在 `docs/learning/notes/` 下新建 `experiment-XX.md`（目录可自建），至少包含：

```markdown
# Experiment XX — 标题

- 日期：
- 本周问题：
- 假设（跑之前写）：
- 固定条件：seed / 请求数 / 到达率 / batch / KV / chunk / prefix
- 变量：
- 命令：
- 指标：TTFT P50/P95、TPOT P50/P95、E2E P95/P99、吞吐、峰值 KV
- 结果（模拟 / 实测，必须标注）：
- 与假设的差异：
- 我现在的解释：
- 局限 / 下一步：
```

**规则**

1. 先写预测，不要跑完再补。
2. 一次只改一个参数。
3. 同一实验至少重复一次，确认 seed 与输出一致。
4. 结论必须能回答“为什么”，不能只写“更快/更慢”。
5. 模拟结果不能外推为真实硬件性能。

---

## 1. 基线：FCFS vs Continuous Batching

**问题**：在同一 workload 下，两种策略的吞吐和尾延迟差在哪里？

```bash
pnpm demo --requests 80 --rate 1.5 --seed 42
```

记录：

- FCFS 与 CB 的 req/s、TTFT P50/P95、TPOT P50/P95、E2E P95。
- 两者的 step 数差异（CLI 的 trace 行 / JSON）。
- 运行 `pnpm demo --json`，保存 JSON 作为对照。

**跑之前先预测**：

- 哪一个吞吐更高？
- 哪一个 TPOT 更好？为什么这可能反直觉？
- FCFS 的 TTFT 尾部由什么主导？

**写报告时回答**：如果把 batch size 设为 1，CB 还比 FCFS 好吗？为什么？

---

## 2. 到达率扫描：找到饱和点

**问题**：系统从“空闲”到“排队爆炸”的拐点在哪里？

```bash
pnpm demo --requests 100 --rate 0.5 --seed 7
pnpm demo --requests 100 --rate 1.5 --seed 7
pnpm demo --requests 100 --rate 3   --seed 7
pnpm demo --requests 100 --rate 6   --seed 7
```

记录每个 rate 下：

- FCFS / CB 的吞吐（是否接近到达率？）
- TTFT P95（是否开始非线性增长？）
- 峰值 KV、平均 batch size

**关键概念**：利用率接近 1 时，队列和 P95 会急剧上升；吞吐不会无限增长。

**进阶**：用 Little's Law 估算系统中的平均请求数，并与 UI 时间轴上的 queue + running 对照。

---

## 3. Batch size 扫描：吞吐与 TPOT 的权衡

**问题**：batch 越大越好吗？收益在哪里开始递减？

```bash
pnpm demo --requests 80 --rate 1.5 --seed 42 --max-batch 1
pnpm demo --requests 80 --rate 1.5 --seed 42 --max-batch 4
pnpm demo --requests 80 --rate 1.5 --seed 42 --max-batch 8
pnpm demo --requests 80 --rate 1.5 --seed 42 --max-batch 16
```

记录：

- req/s、output tok/s
- TTFT P50/P95
- TPOT P50/P95
- 峰值 KV

**预测**：吞吐上升，TPOT 变差；TTFT 可能先变好（排队减少）再变差（batch 竞争）。
**注意**：FCFS 忽略 `--max-batch`，它的行基本不变，这是很好的对照组。

---

## 4. KV 容量扫描：容量如何变成延迟

**问题**：KV block 减少时，系统先牺牲什么？

```bash
pnpm demo --requests 80 --rate 1.5 --seed 42 --blocks 512
pnpm demo --requests 80 --rate 1.5 --seed 42 --blocks 1024
pnpm demo --requests 80 --rate 1.5 --seed 42 --blocks 2048
```

记录：

- 峰值 active / reserved blocks
- 是否出现准入受限（running 数下降、queue 增长）
- TTFT P95、E2E P95/P99
- 是否触发 prefix cache 驱逐（在 prefix-heavy 场景更有意义）

**关键**：本项目按最坏情况预留，所以 KV 容量对并发的影响会比真实分页系统更“硬”。
这正是后续 M6 的动机。

---

## 5. Prefix Cache：省了计算，还是省了并发？

**问题**：开启 Prefix Cache 后，TTFT 和吞吐分别怎么变？

```bash
pnpm demo --requests 80 --rate 1.5 --seed 42
pnpm demo --requests 80 --rate 1.5 --seed 42 --prefix-cache
```

记录：

- 命中请求数 / 命中 token 数 / token 命中率
- 物理 KV vs logical-active KV
- TTFT P50/P95、TPOT、E2E
- FCFS 与 CB 的差异

**关键观察**：本项目 prefix 命中主要减少 prefill 计算和物理重复，
**不提高 admission 并发**，因为 reservation 仍是 full worst-case。
这是一个很好的面试讨论点：为什么“省显存”不一定“提高并发”？

---

## 6. Prefix 池与命中率

**问题**：共享前缀越长、复用越集中，命中率如何变化？

```bash
pnpm demo --requests 80 --rate 1.5 --seed 42 --prefix-cache --prefix-pool 1 --prefix-prob 1.0
pnpm demo --requests 80 --rate 1.5 --seed 42 --prefix-cache --prefix-pool 4 --prefix-prob 0.75
pnpm demo --requests 80 --rate 1.5 --seed 42 --prefix-cache --prefix-pool 8 --prefix-prob 0.5
```

记录：

- 命中率 vs prefix pool / probability
- 物理 KV 峰值 vs logical block 数
- 是否出现 retained（空闲缓存）内存占用

**进阶**：在 UI 中打开：

```text
http://localhost:5173/?scenario=prefix-heavy&tab=continuous-batching&step=0.8
```

观察 active / retained / shared 的变化，并解释 `retained` 为什么不是“泄漏”。

---

## 7. Prefill chunk 大小

**问题**：chunk 越小，TTFT 与 TPOT 如何 trade-off？

```bash
pnpm bench --scenario steady --batch-sizes 8,16 --chunks 128,256,512 --kv-blocks 2048
```

记录每个 chunk 的：

- TTFT P50/P95
- TPOT P50/P95
- E2E P99
- step 数（trace 行）

**预测**：chunk 小 → 单步 prefill 更轻、decode 干扰更小，但完成 prompt 需要更多 step，
TTFT 可能变差。不要只跑一个 chunk；用 JSON 里的全矩阵比较。

---

## 8. 长上下文与 KV 压力

**问题**：长 prompt 下，KV 容量是否成为第一瓶颈？

```bash
pnpm bench --scenario long-context --batch-sizes 4,8 --chunks 256,512 --kv-blocks 512,1024,2048
```

记录：

- 每个 cell 的 TTFT P95、E2E P99、峰值物理 KV
- running 数是否被 KV 限制
- 小 KV 下是否出现更长的 queue

**注意**：这是模拟，不是 Mac 真实显存；但“容量 → 并发 → 排队”的机制是真实存在的。

---

## 9. 尾延迟：P50 会骗你

**问题**：为什么平均/中位数看起来正常，P99 却很差？

```bash
pnpm bench --scenario bursty --batch-sizes 8,16 --chunks 256,512 --kv-blocks 1024
```

在 JSON 或 CLI 表格中对比：

- TTFT P50 vs P95 vs P99
- E2E P50 vs P99
- FCFS 与 CB 的尾部差距
- 队列长度随时间的峰值（UI 时间轴）

**写报告时回答**：

- 哪个策略更“稳定”？
- 如果 SLO 是 P95 TTFT < 1s，哪个 cell 满足？这就是 goodput 视角。

---

## 10. 可复现性

**问题**：同 seed 是否真的同结果？哪些操作会破坏复现？

```bash
diff <(pnpm bench --smoke --json 2>/dev/null) <(pnpm bench --smoke --json 2>/dev/null)
```

预期：无输出（完全一致）。

再试：

- 改 seed，确认结果不同；
- 改 Node/pnpm 版本或依赖版本，观察是否有差异；
- 改代码后再检查 benchmark 的 `schemaVersion` / `costModelVersion` 是否需要 bump。

**写报告时回答**：可复现性保证了什么？不保证什么？

---

## 11. 源码阅读路线（配合实验）

按顺序读，不要从头到尾逐行：

1. [`src/core/types.ts`](../../src/core/types.ts)
   - `RequestSpec`、`StepPlan`、`Scheduler`、`CacheView`、`StepRecord`
   - 问题：为什么调度器只能返回计划，不能直接改状态？
2. [`src/core/engine.ts`](../../src/core/engine.ts)
   - 事件循环、`#executeStep`、`#validatePlan`
   - 问题：prefix 命中后，为什么 prefill intent 需要 clamp？
3. [`src/core/schedulers/continuous-batching.ts`](../../src/core/schedulers/continuous-batching.ts)
   - 问题：为什么 decode 优先？新请求何时被接纳？
4. [`src/core/kv-cache.ts`](../../src/core/kv-cache.ts)
   - `reserve` / `appendTokens` / `free` / 驱逐 / `validate`
   - 问题：为什么预留最坏情况可以避免死锁？代价是什么？
5. [`src/core/metrics.ts`](../../src/core/metrics.ts)
   - 问题：TPOT 的分母为什么是 `outputTokens - 1`？单 token 请求怎么处理？
6. [`src/core/benchmark.ts`](../../src/core/benchmark.ts)
   - 问题：为什么报告不包含 wall-clock 时间？如何保证矩阵可复现？
7. [`src/app/lib/timeline.ts`](../../src/app/lib/timeline.ts)
   - 问题：如何从 step trace 重建任意时刻的请求状态？

每个文件读完后，在周记里写 3 句话：

- 它解决什么问题？
- 它的关键不变量是什么？
- 如果让你改一个地方，你会改哪里，怎么验证？

---

## 12. 实验之后

- 把最有价值的两篇实验整理成公开博客（中文或英文均可）。
- 在简历里只写你真正做过的实验，并标注 simulated / measured。
- 如果准备进入 M6，先写设计文档，再改代码：
  - 如何区分 shared / retained / exclusive reservation？
  - 驱逐、preemption、recompute 的优先级？
  - 如何用 property test 证明不会死锁？
