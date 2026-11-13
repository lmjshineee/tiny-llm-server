# 从项目到实习：作品集与面试准备

> 目标不是“把项目写进简历”，而是让面试官相信你能**设计、验证、解释**一个推理系统。
> 每周从 15 小时里拿出 1 小时做表达练习；第 8 周集中整理。

---

## 1. 你目前已经拥有的证据

- 一个可运行的确定性模拟器：FCFS、continuous batching、paged KV、prefix cache。
- 83 个测试，包含 property-based tests 与 UI 测试。
- 5 个场景 / 80 个 matrix cell 的 benchmark，版本化 JSON。
- React 可视化：时间轴、队列、请求状态、KV 占用、指标对比。
- 一份架构文档，明确写出模拟边界与未实现项。

还缺的不是更多功能，而是：

1. 公开、可访问的 demo；
2. 2–3 篇能展示思考过程的实验笔记；
3. 一份诚实、可追问的简历描述；
4. 流畅的 2 分钟 / 10 分钟讲解。

---

## 2. 项目叙事（先背结构，不要背稿）

### 30 秒版本

> 我做了一个 LLM 推理调度实验室，用离散事件模拟比较 FCFS 和 continuous batching。
> 它自己实现分页 KV Cache、prefix cache、token/batch 预算和性能指标，
> 还有 React 时间轴可视化。重点不是跑分，而是解释 TTFT、TPOT、吞吐和 KV 容量之间的
> trade-off；所有结果都明确标注为模拟，测试和 benchmark 都是可复现的。

### 2 分钟版本

按这个顺序：

1. **问题**：真实 serving 受模型、显存、硬件影响，难以隔离调度变量。
2. **约束**：16 GB Mac、无 GPU；选择模拟而不是假装跑大模型。
3. **设计**：事件驱动引擎 + 纯函数 scheduler + 带预留的分页 KV + 可选 prefix cache。
4. **验证**：unit/property/UI tests、seed 复现、benchmark schema。
5. **发现**：CB 提升吞吐但可能恶化 TPOT；prefix 省 prefill 与物理内存，但当前 admission
   仍被最坏情况预留限制。
6. **下一步**：prefix-aware admission / preemption；可选小模型校准。
7. **边界**：单机、模拟、无生产流量；不宣称硬件性能。

### 10 分钟深挖

准备好展开任意一条：

- 为什么用事件驱动，而不是固定 tick？
- 为什么 scheduler 只返回 plan？引擎如何校验？
- 为什么 KV 预留最坏情况？死锁如何避免？
- prefix cache 的引用计数、retention、LRU 驱逐如何保证不 double free？
- 为什么 UI 只显示聚合 KV，而不是物理 block ID？
- benchmark 如何保证可复现？schemaVersion / costModelVersion 有什么用？

---

## 3. 简历写法

标题示例：

```text
LLM Serving Lab — 独立项目（TypeScript / React / 系统模拟）
```

可选 bullet（按你实际完成的挑 3–4 条）：

- 设计并实现事件驱动的 LLM 推理调度模拟器，支持 FCFS 与 iteration-level continuous
  batching，显式建模 prefill/decode、token budget 与 batch 限制。
- 实现分页 KV Cache（block table、预留、懒分配、释放、容量限制）与可选 Prefix Cache
  （整块共享、引用计数、保留、LRU 驱逐），并用 property-based tests 验证容量与生命周期不变量。
- 构建可复现的 benchmark harness：5 个场景、调度器/batch/chunk/KV 矩阵、P50/P95/P99、
  版本化 JSON 报告与 CI smoke tests。
- 开发 React 可视化：时间轴回放、队列/请求状态、KV 占用、FCFS vs CB 指标对比；
  UI 与 headless core 解耦，包含 jsdom/Testing Library 测试。
- （如完成）在 Apple M5 上用 1B 级 4-bit 小模型测量 prefill/decode 曲线，校准模拟成本模型，
  并在报告中标注机器、模型、量化方式与限制。

**不要写**：

- “支撑生产流量”“提升线上吞吐 X%”——除非真的做过。
- 把模拟结果写成硬件结果。如果要提，写清楚 “simulated”。
- 列一堆你只跑过一次、无法解释的框架。

### 数字怎么处理

可以写“83 tests”“5 scenarios × 80 cells”“4 scheduler/KV/chunk/batch 维度”，这些是可验证的。
不要写“TTFT 降低 99.6%”这类数字而不加 context；模拟结果会引来追问，而且很容易被认定为夸大。

---

## 4. 高频问题与答题角度

### 基础

1. **Prefill 和 decode 的区别？**
   - prefill 并行处理 prompt，计算密集；decode 每步 1 token，通常受内存带宽限制。
   - KV Cache 的作用与首 token 语义。
2. **7B / GQA 的 KV Cache 怎么算？**
   - 写出 `2 × L × H_kv × D_head × bytes`；给一个具体例子；讨论量化与上下文长度。
3. **TTFT / TPOT / E2E / throughput / goodput 分别是什么？**
   - 每个指标的分母、适用场景；为什么需要 P99。

### 调度与内存

4. **Continuous batching 为什么有效？代价是什么？**
   - 减少 HOL、提高 GPU 利用率；batch 变大、prefill/decode 混步会拉高 TPOT/P99。
5. **PagedAttention 解决了什么？**
   - 外部碎片、连续扩容、共享；代价是 block table 与间接寻址。
6. **Prefix cache 命中后为什么并发不一定提高？**
   - 本项目 admission 仍按全序列 worst-case 预留；共享块可被保留/驱逐，但预留没有拆分。
   - 讨论如何做 prefix-aware admission。
7. **Preemption 的 recompute 与 swap 怎么选？**
   - 计算 vs 带宽/存储；TTFT 与吞吐；实现复杂度；SLO。
8. **Chunked prefill 的收益与副作用？**
   - 降低单步长尾、改善 decode 干扰；可能拉长 TTFT、增加调度开销。
9. **FCFS 在哪些 workload 下最差？**
   - 长短混合、长请求在前、接近饱和；HOL blocking。

### 实验与系统

10. **你怎么保证模拟器正确？**
    - 不变量、plan validation、property tests、确定性 seed、容量守恒、生命周期测试。
11. **怎么 benchmark 才可信？**
    - warm-up、重复、median/variance、硬件/模型/版本、P95/P99、固定 workload；区分模拟/实测。
12. **吞吐上升但 P99 变差，怎么排查？**
    - 队列、batch 组成、prefill 干扰、KV 准入、调度策略、尾部长请求。
13. **设计一个多租户 SLO 调度器？**
    - 先问 SLO（TTFT/TPOT/goodput）、优先级/公平性、隔离、preemption、admission。
    - 不要直接说“用 vLLM”。
14. **模拟与真实硬件的差距怎么补？**
    - 测量 prefill/decode 曲线、拟合 profile、记录硬件；只用于校准，不宣称生产性能。
15. **如果给你一台 8×H100，你会做什么？**
    - 先明确目标（吞吐/延迟/成本）；测 roofline；再谈 batching、并行、KV 传输；
    - 不要在没有数据时给结论。

### 行为与反思

16. **这个项目里最难的决定？**
    - 例：为了 deadlock-free 选择 worst-case reservation，牺牲并发；后来如何计划 prefix-aware admission。
17. **你犯过的错误？**
    - 例：一开始让 scheduler 直接改状态，后来改成 plan + engine validation；
    - 或 prefix 命中后 prefill intent 需要 clamp 才能通过校验；
    - 或 KV 统计字段在缓存/物理/逻辑之间混乱，后来用不变量测试收敛。
18. **你为什么不做真实 GPU 推理？**
    - 先隔离调度变量；16 GB Mac 约束；模拟可复现；真实测量作为后续校准，而不是假装拥有硬件。
19. **如果重做一次，你会先做什么？**
    - 先定义指标与失败模式，再写 scheduler；先有 property tests，再扩 UI。
20. **你如何学习一个陌生的 serving 系统？**
    - 先画请求生命周期，再找 scheduler/cache/metrics 三个入口，跑一个小 workload，做对照实验。

---

## 5. 每周 1 小时的表达练习

| 周 | 练习 | 产出 |
| --- | --- | --- |
| 1 | 录 2 分钟项目介绍 | 回听，删掉形容词，补上限制 |
| 2 | 白板画请求生命周期 | 一张图，能讲清 prefill/decode/KV |
| 3 | 解释 TTFT/TPOT trade-off | 3 分钟，不看稿 |
| 4 | 讲 prefix cache | 画 block table + refcount |
| 5 | 讲 benchmark 方法 | 说明 seed、warm-up、P99、模拟边界 |
| 6 | 讲 M6 设计 | 只讲设计，不写代码 |
| 7 | 模拟面试 1 | 10 个问题，录音 |
| 8 | 模拟面试 2 + 简历定稿 | 2 分钟 + 深挖 10 分钟 |

练习时遵循：

- 先说结论，再说原因，最后说限制。
- 每提到一个指标，说明它的分母/时间窗。
- 主动说出“这是模拟，不是实测”，比被追问更好。
- 不会的问题说“我还没验证”，然后给出验证方案。

---

## 6. 作品集清单

- [ ] GitHub 公开仓库，README 首屏有 demo 截图与运行命令。
- [ ] GitHub Pages / 静态 demo（明确 SIMULATED）。
- [ ] 架构文档一页（已有）。
- [ ] 2 篇实验笔记：例如“为什么 CB 的 TPOT 更差”“prefix 命中为何没有提高并发”。
- [ ] 一份 benchmark JSON + 一段解读（不是只贴表）。
- [ ] 简历一页，项目 bullet 可被追问。
- [ ] 2 分钟讲解视频/录音（不必公开）。
- [ ] 10 个高频问题的自答草稿。

---

## 7. 诚实边界（面试时必须能说）

- 这是**单机、模拟**系统，不是生产 serving。
- 成本模型是合成的；没有真实模型/GPU 性能结论。
- Prefix key 是合成的，不是真实 token hash。
- KV admission 使用 worst-case reservation，尚未实现 prefix-aware admission/preemption。
- UI 的 KV 图是聚合占用，不是物理 block ID。
- 83 个测试通过；CI 工作流已写，但尚未在 GitHub 上实际执行（没有 remote）。

把这些说清楚，不会减分；反而会显得你知道系统的边界。
