# 学习路线：从模拟器到 LLM Infra 实习

> 适用对象：每周约 **15 小时**、准备 8 周、目标为 LLM 推理系统 / AI Infra 实习。
> 当前项目状态：M0–M4 已完成（模拟器、调度、KV Cache、Prefix Cache、Benchmark、React 可视化，
> 83 个测试）。**本目录是学习计划，不代表 M5/M6 或真实模型校准已经实现。**

---

## 1. 这份计划怎么用

- **按周推进，不要按天堆任务。** 每周结束时必须留下一个可复查的产出。
- **先预测，再跑实验，最后写解释。** 没有写下来的结论，等于没学过。
- **一次只改一个变量。** 否则你无法把结果归因到 batch、KV、chunk 或前缀。
- **明确区分模拟与实测。** 项目中的延迟/吞吐都来自合成模型；实测必须记录机器、模型、量化方式。
- **每周末提交一次。** 笔记、实验报告、README 更新都算作品集的一部分。
- **不要抄代码。** 可以读 vLLM / SGLang / Mini-SGLang 的结构和思路，但实现要自己写、自己测。

每周 15 小时的分配建议：

| 类型 | 小时/周 | 产出 |
| --- | ---: | --- |
| 阅读论文/源码 | 4 | 1 页 reading note |
| 写代码与做实验 | 7 | 1 个实验或一个小改进 |
| 写作/整理 | 2 | 实验报告或周记 |
| 复习 + 清理 + CI | 1 | 测试通过、提交 |
| 面试/表达练习 | 1 | 2 分钟项目讲解录音或问答 |
| **合计** | **15** | |

> 8 周 × 15 小时 = 120 小时。如果某周被占用，**延长周数，不要压缩理解**。

---

## 2. 八周安排

| 周 | 主题 | 阅读 | 动手 | 本周产出 |
| --- | --- | --- | --- | --- |
| 1 | 建立地图 | 项目 README / ARCHITECTURE；Orca 论文 | 跑 demo、bench、UI；画一张推理流程图 | `week-01.md` + 概念图 |
| 2 | Prefill / Decode / 指标 | Orca 复读 + 指标章节 | 实验 1–2；手算 KV Cache | `experiment-01.md` |
| 3 | 排队与 batching | PagedAttention 论文 | 实验 3、4；观察 TTFT/TPOT 权衡 | `experiment-02.md` |
| 4 | KV / Prefix Cache | 项目 KV 章节 + RadixAttention 选读 | 实验 5、6；对比 prefix on/off | `experiment-03.md` |
| 5 | Benchmark 与测量 | 测量方法；vLLM 调度器源码选读 | 实验 7–9；读 `engine.ts` / `kv-cache.ts` | `reading-01.md` |
| 6 | 调度器进阶 | Sarathi / preemption 资料 | 先写设计文档；若继续编码，再做 prefix-aware admission | 设计文档 + 评审清单 |
| 7 | 小模型校准（可选） | llama.cpp / MLX 文档 | 测 prefill/decode 曲线；拟合 profile | `calibration-01.md` |
| 8 | 作品集与面试 | 自己的笔记 | 博客、demo、简历、模拟面试 | 2 分钟讲解 + 简历 |

**第 6–7 周标记为“后续阶段”。** 在你明确决定继续写代码或下载模型之前，只做阅读和设计。
第 8 周不是“学完再准备”，而是把前 7 周的产物整理成可展示的证据。

如果只有 4 周：把第 1–4 周压缩为 2 周，第 5–8 周只保留 benchmark 与面试，不要碰 M6。

---

## 3. 每周固定节奏

建议把 15 小时拆成 5 次，避免周末突击：

| 时间 | 内容 |
| --- | --- |
| 周一 1h | 定目标：本周一个问题、一个实验、一个产出 |
| 周二 3h | 阅读论文/源码，写 5 条笔记 |
| 周三 3h | 做实验，记录命令、seed、配置 |
| 周四 3h | 整理结果，补一个对照实验 |
| 周五 2h | 写实验报告 / 周记 |
| 周六 2h | 清理代码、补测试、提交 |
| 周日 1h | 面试表达练习 + 下周计划 |

**周记格式** 见 [`NOTES_TEMPLATE.md`](NOTES_TEMPLATE.md)。

---

## 4. 实习就绪标准

完成计划后，你应当能做到：

- [ ] 不看稿讲 2 分钟项目：问题、设计、trade-off、限制。
- [ ] 徒手推导 KV Cache 大小，并解释 GQA / 量化对它的影响。
- [ ] 解释 FCFS、静态 batching、continuous batching、chunked prefill 的差异。
- [ ] 解释为什么 continuous batching 提高吞吐但可能恶化 TPOT。
- [ ] 解释 PagedAttention、prefix cache、preemption/recompute 的动机与代价。
- [ ] 用 Little's Law 和利用率解释队列、P95 和过载。
- [ ] 独立设计一个对照实验，并用数据回答“为什么”。
- [ ] 说明本项目的模拟边界：成本模型、最坏情况预留、聚合 KV 视图。
- [ ] 有 3 个可展示产物：公开 demo、benchmark 报告、2 篇实验笔记。
- [ ] 简历上每一句都能被追问 10 分钟，且不虚构实测数据。

---

## 5. 阅读顺序（先读什么）

1. **Orca**（continuous batching 的动机）— 2h
2. **vLLM / PagedAttention**（KV 分页与共享）— 2.5h
3. **Sarathi-Serve**（chunked prefill 与吞吐/延迟权衡）— 2h
4. **SGLang / RadixAttention**（前缀树复用）— 2h
5. **vLLM 源码选读**（scheduler + block manager）— 3h
6. **DistServe**（goodput / SLO）— 选读，1.5h
7. **FlashAttention**（背景）— 选读，2h

详细资源、每篇的阅读问题和源码入口见 [`RESOURCES.md`](RESOURCES.md)。

---

## 6. 本目录索引

| 文件 | 内容 |
| --- | --- |
| [`CONCEPTS.md`](CONCEPTS.md) | 推理基础、KV 公式、指标、排队、prefix/preemption、自测题 |
| [`EXPERIMENTS.md`](EXPERIMENTS.md) | 10 个实验、命令、报告模板、源码阅读路线 |
| [`INTERNSHIP.md`](INTERNSHIP.md) | 简历、项目叙事、面试题、作品集清单 |
| [`RESOURCES.md`](RESOURCES.md) | 论文、源码、工具、小模型校准准备 |
| [`NOTES_TEMPLATE.md`](NOTES_TEMPLATE.md) | 周记 / 实验 / 阅读 / 2 分钟讲解模板 |

---

## 7. 第一条规则

**不要用“我跑了很多 benchmark”代替“我能解释为什么”。**

实习面试里，最稀缺的不是会调 vLLM 的人，而是能说清楚：

> 这个请求为什么在这里排队？这块 KV 为什么不能释放？这个策略牺牲了什么？

这个项目已经给了你一个安全的沙盒。把每个“为什么”写下来，就是经验。
