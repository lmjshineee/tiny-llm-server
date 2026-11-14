# 概念地图：LLM 推理与调度

> 目标不是背定义，而是能在白板上解释“为什么”。每个概念都尽量对应到本项目的代码或实验。
>
> 如果你只写过类 Llama 的 Transformer、没接触过推理服务：先读
> [《从 Transformer 到推理服务》](FROM_TRANSFORMER_TO_SERVING.md)，
> 本文可以当它的速查表。

---

## 1. 一次推理发生了什么

一个请求包含 prompt tokens 和待生成 token 数，服务过程分两个阶段：

| 阶段 | 输入 | 主要工作 | 时间特征 |
| --- | --- | --- | --- |
| **Prefill** | 整段 prompt | 计算所有 prompt token 的 QKV / attention / MLP，填充 KV Cache | 计算量大，通常并行度高；首 token 在结束前产生 |
| **Decode** | 上一步生成的 token | 读取全部权重与历史 KV，算一个新 token | 每步只算 1 token，通常受内存带宽限制 |

关键点：

- **Prefill 决定 TTFT 的大部分**（再加上排队时间）。
- **Decode 决定 TPOT 与总生成时间**。
- KV Cache 保存每层历史的 K/V，避免 decode 时重算整个前缀。
- 请求生成第 1 个 token 后进入 decode；本项目把首 token 记在 prefill 步结束。
- 现代模型常用 **GQA/MQA**，KV heads 少于 attention heads，KV Cache 更小。

---

## 2. KV Cache 大小

### 公式

对每个 token、每层保存 K 和 V：

```text
KV bytes / token = 2 × L × H_kv × D_head × bytes_per_element
```

- `L`：层数
- `H_kv`：KV heads 数（GQA 时小于 attention heads）
- `D_head`：每个 head 的维度
- `2`：K 和 V 各一份
- `bytes_per_element`：fp16 = 2，fp8/int8 = 1，4-bit ≈ 0.5

整个序列：

```text
KV bytes = sequence_tokens × KV bytes / token
```

### 例子（请自己复算）

假设 `L=32`、`H_kv=8`、`D_head=128`、fp16：

```text
2 × 32 × 8 × 128 × 2 = 131,072 bytes = 128 KiB / token
8,192 tokens × 128 KiB ≈ 1 GiB / sequence
```

所以在 16 GB 统一内存的 Mac 上：

- 模型权重（例如 7B 4-bit）大约占 3.5–4.5 GB；
- 剩余内存不可能全部给 KV；
- 长上下文 + 高并发会迅速吃满 KV 预算。

> 这也是为什么本项目把 **KV block 容量** 作为一级参数，而不是只改 batch size。

### 分页

连续分配一个大 KV 区域会产生外部碎片，且难以共享。PagedAttention 把 KV 切成固定大小 block：

- 每个请求有 block table，逻辑位置 → 物理 block；
- 按需分配，减少预留浪费；
- 相同前缀的 block 可以引用同一物理块；
- 代价是多一层间接寻址，以及更复杂的生命周期管理。

本项目使用 16-token block，见 [`src/core/kv-cache.ts`](../../src/core/kv-cache.ts)。

---

## 3. 指标

| 指标 | 定义 | 回答的问题 |
| --- | --- | --- |
| **TTFT** | arrival → first token | 用户多久看到第一个字？ |
| **TPOT / ITL** | 相邻输出 token 的平均间隔 | 后续生成有多快？ |
| **E2E** | arrival → last token | 整个请求多久完成？ |
| **Throughput** | completed requests / makespan | 系统吞吐多大？ |
| **Output tok/s** | generated tokens / makespan | 生成吞吐多大？ |
| **Goodput** | 满足 SLO 的请求数 / 时间 | 在延迟约束下有多少有效吞吐？ |
| **P50 / P95 / P99** | 分位数 | 大多数 / 尾部用户体验如何？ |

常见误区：

- 只看平均延迟：均值会被大量快请求掩盖，P99 才反映排队与调度问题。
- 只看吞吐：把 batch 开大通常能提高吞吐，但 TPOT 和 P99 可能恶化。
- 忽略 makespan 的起点：本项目从第一个请求到达算起，包含 ramp-up 与 drain。

### 排队视角

- **服务时间**：prefill + decode，由模型/硬件决定。
- **等待时间**：排队，由到达率、服务率、调度策略决定。
- **TTFT = 等待 + prefill + 首 token 开销**。

Little's Law：

```text
系统中的平均请求数 L = 到达率 λ × 平均停留时间 W
```

利用率接近 1 时，队列和尾延迟会非线性上升。FCFS 的 head-of-line blocking 会让一个慢请求拖住整条队列。

---

## 4. 调度策略

### FCFS（顺序基线）

- 先到先服务，一次只处理一个请求（本项目的 FCFS 实现）。
- 简单、可预测，但长请求会阻塞后面的短请求。
- KV 与 token budget 在很多时候是空闲的。

### Static batching

- 从队列取一批请求，一起跑完再取下一批。
- 吞吐比串行好，但批次内短请求要等最长请求（batch tail）。

### Continuous batching（iteration-level）

- 每个 decode step 都可以加入新请求、移除完成请求。
- 通常 decode 优先，再继续 prefill / 接纳新请求。
- 直接减少 head-of-line blocking，提高吞吐；但 decode step 变大、混合 prefill 会拉高 TPOT。

### Chunked prefill

- 把长 prompt 切成多个 chunk，分步计算。
- 避免一个超长 prefill 占满整个 step，改善尾延迟。
- 代价是请求的 prefill 被拉长，TTFT 可能增加，且 decode 会与 prefill 共享 step。

### Preemption

当 KV 不足或高优先级请求到达时：

- **Recompute**：丢弃 KV，稍后重新 prefill；实现简单，浪费计算。
- **Swap**：把 KV 换到 CPU/磁盘；省计算，但增加传输与复杂度。

本项目当前**没有 preemption**，并且采用全序列最坏情况预留；这是后续 M6 的学习点。

---

## 5. Prefix Cache

当多个请求共享相同前缀（system prompt、few-shot 示例）：

- 按 block 计算内容 hash（通常和父 block hash 链式组合，避免位置歧义）；
- 相同 hash 的 block 共享物理 KV；
- 用引用计数管理生命周期；
- 请求结束后可以保留（retention），后续命中；
- 内存压力下按 LRU 等策略驱逐空闲块。

### 本项目的简化

- 没有真实 token 文本，所以用**合成 prefix key**，不是内容 hash；
- admission 仍按全序列最坏情况预留，prefix 命中主要减少 prefill 计算与物理重复，
  不提升 admission 并发；
- 为了保留 prefill → first-token 路径，命中最多到 `promptTokens - 1`；
- 并发 miss 可能重复计算同一前缀。

这些限制不是“缺陷”，而是后续 M6 “prefix-aware admission” 的入口。

---

## 6. 模拟器设计

本项目用离散事件模拟：

- 虚拟毫秒时钟 + 最小堆；
- `arrival` 与 `step` 两类事件；
- 每个 step 由调度器返回 `admit / prefill / decode` 计划；
- 引擎校验计划后再改状态；
- KV 分配器负责 reserve / append / free；
- 每个 step 记录 KV 快照，供 UI 回放；
- 同一 seed + 配置 ⇒ 同一 trace。

成本模型是**合成**的：

```text
step_latency = overhead
             + (prefill ? prefillBase + P × prefillMsPerToken : 0)
             + (decode  ? decodeBase  + D × decodeMsPerRequest : 0)
```

它刻意做了简化：忽略 attention 长度平方项、带宽竞争、hash 开销、网络与硬件差异。
它适合学习调度机制，不适合得出硬件性能结论。

---

## 7. 模拟 vs 实测

| 问题 | 模拟 | 实测 |
| --- | --- | --- |
| 可复现性 | 高 | 受机器、温度、驱动影响 |
| 成本 | 低 | 需要模型、显存、时间 |
| 能回答 | 调度策略、容量边界、排队 | 真实吞吐、TTFT、硬件利用率 |
| 不能回答 | 绝对性能、硬件排名 | 所有参数的因果机制 |

校准测速的最低要求：

- 记录模型、量化、机器、OS、runtime 版本；
- warm-up，多次重复，取中位数，报告离散度；
- 固定输入长度、输出长度、batch；
- 分开测 prefill 与 decode；
- 不把一次测量包装成“生产 benchmark”。

---

## 8. 自测题（先自己答，再展开）

1. 7B 模型，32 层，8 个 KV heads，head_dim=128，fp16，每 token KV 多少？8k context 呢？
2. 为什么 continuous batching 能提高吞吐，却可能让 TPOT 变差？
3. 本项目 prefix 命中后，为什么 admission 并发没有提高？
4. Goodput 和 throughput 的区别是什么？
5. 分页 KV 相比连续分配，减少了哪类碎片？增加了什么开销？
6. 为什么 decode 通常更受内存带宽限制？
7. FCFS 在什么 workload 下最吃亏？
8. Preemption 的 recompute 与 swap 各自牺牲什么？
9. 为什么只看 P50 会误判 serving 系统？
10. 同一个 seed 能保证什么，不能保证什么？

<details>
<summary>参考答案（展开）</summary>

1. `2 × 32 × 8 × 128 × 2 = 128 KiB/token`；8,192 tokens ≈ 1 GiB。
2. 每个 step 要服务更多序列，decode step 变慢；混合 prefill 还会增加单步延迟；
   吞吐上升、单流 TPOT 与尾延迟可能变差。
3. 因为 admission 仍按 prompt+maxNew 的全序列最坏情况预留，prefix 块虽然共享，
   但预留计数没有按“已共享/可驱逐/未来专属”拆分。
4. Goodput 只统计满足 SLO 的请求；throughput 可能靠牺牲延迟堆出来。
5. 减少外部碎片和连续扩容问题；增加 block table、间接寻址、引用计数与驱逐复杂度。
6. Decode 每步只生成一个 token，但必须读取全部权重与所有历史 KV；计算量相对内存访问很小。
7. 长短请求混合、长请求在前、负载接近饱和时；队头长请求会阻塞大量短请求。
8. Recompute 浪费算力、增加延迟；swap 需要搬运 KV，占用 PCIe/内存带宽与额外存储。
9. 平均值/中位数掩盖排队尾部；P95/P99 才反映少数用户体验和 SLO 违约。
10. 相同的合成 workload 与确定性执行路径；不保证真实硬件性能、不同版本/配置下的相同结果。

</details>

---

## 9. 术语表

| 术语 | 一句话解释 |
| --- | --- |
| Prefill | 一次计算整段 prompt，并生成首 token / KV |
| Decode | 每步生成 1 个 token 的阶段 |
| KV Cache | 缓存历史 K/V，避免重复计算 |
| Block table | 逻辑 token 位置到物理 KV block 的映射 |
| PagedAttention | 用分页 block 管理 KV 注意力缓存 |
| Continuous batching | 每个 step 动态加入/移除请求的 batching |
| Chunked prefill | 将 prefill 拆成多个小步 |
| Prefix cache | 复用相同前缀的 KV block |
| Admission | 决定新请求现在能否进入运行集 |
| Preemption | 回收运行中请求的 KV，稍后恢复 |
| TTFT | Time To First Token |
| TPOT / ITL | Time Per Output Token / Inter-Token Latency |
| Goodput | 满足 SLO 的有效吞吐 |
| HOL blocking | 队头阻塞 |
| GQA / MQA | Grouped / Multi-Query Attention，减少 KV heads |
| Roofline | 计算/带宽瓶颈的分析模型 |
| Makespan | 从最早到达到最后完成的时间窗 |
| P99 | 99% 请求不超过的延迟值 |
| Simulator | 用模型替代真实执行、可重复实验的系统 |
| Calibration | 用实测数据拟合/修正模拟参数 |

---

## 10. 下一步

- 用 [`EXPERIMENTS.md`](EXPERIMENTS.md) 做实验，不要只读。
- 读 [`RESOURCES.md`](RESOURCES.md) 的论文时，每篇只回答三个问题：
  1. 它解决什么瓶颈？
  2. 代价是什么？
  3. 如果放到本项目，哪个模块会变？
- 把答案写进 [`NOTES_TEMPLATE.md`](NOTES_TEMPLATE.md) 的周记。
