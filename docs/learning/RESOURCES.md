# 资源清单：少而精

> 不要收藏一堆链接。每篇材料至少回答：**它解决什么瓶颈？代价是什么？本项目哪个模块会变？**
> 建议按顺序读，每篇 2–3 小时，读完写 5 条笔记。

---

## 1. 必读论文（按顺序）

| 顺序 | 材料 | 为什么读 | 预计 |
| ---: | --- | --- | ---: |
| 1 | [**Orca: A Distributed Serving System for Transformer-Based Generative Models**](https://www.usenix.org/conference/osdi22/presentation/yu) (OSDI'22) | Continuous batching 的经典动机：iteration-level scheduling、batch tail | 2h |
| 2 | [**Efficient Memory Management for Large Language Model Serving with PagedAttention**](https://arxiv.org/abs/2309.06180) (SOSP'23) | 分页 KV、block table、共享与碎片；本项目的核心参照 | 2.5h |
| 3 | [**Sarathi-Serve: Taming Throughput-Latency Tradeoff in LLM Inference**](https://arxiv.org/abs/2403.02310) | Chunked prefill、prefill/decode 干扰、吞吐与尾延迟 | 2h |
| 4 | [**SGLang: Efficient Execution of Structured Language Model Programs**](https://arxiv.org/abs/2312.07104) | RadixAttention / 前缀树复用；和本项目的 prefix cache 对照 | 2h |
| 5 | [**DistServe: Disaggregating Prefill and Decoding for Goodput-optimized LLM Serving**](https://arxiv.org/abs/2401.09670) | Goodput、SLO、prefill/decode 分离；选读 | 1.5h |
| 6 | [**FlashAttention**](https://arxiv.org/abs/2205.14135) | 为什么 attention 的 IO 很关键；背景阅读 | 2h |

阅读方法：

1. **第一遍 20 分钟**：摘要、图、结论；写下它解决什么问题。
2. **第二遍 1 小时**：方法部分；画出数据流/调度流程。
3. **第三遍 30 分钟**：实验设置与限制；哪些结论依赖硬件/模型？
4. 写 5 条笔记：问题、核心机制、代价、实验、与本项目的差异。

> 不需要读懂所有数学。先抓住“它把什么变成了可管理的东西”。

---

## 2. 源码阅读

| 项目 | 看什么 | 对应本项目 |
| --- | --- | --- |
| [vLLM](https://github.com/vllm-project/vllm) | `vllm/core/scheduler.py`、block manager、sequence groups | `src/core/schedulers/`、`kv-cache.ts` |
| [SGLang](https://github.com/sgl-project/sglang) | RadixAttention / radix cache、prefix 复用 | `kv-cache.ts` 的 prefix index |
| [Mini-SGLang](https://github.com/sgl-project/mini-sglang) | 教学向的最小 serving 实现；请求生命周期、chunked prefill、overlap scheduling。注意：官方主要面向 Linux + CUDA，macOS 不适合直接运行，读源码即可 | `engine.ts` 的状态机 |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | 本地推理、batching、benchmark 工具 | 后续校准测量 |
| [MLX](https://github.com/ml-explore/mlx) / [mlx-examples](https://github.com/ml-explore/mlx-examples) | Apple Silicon 上的推理与量化 | 后续小模型校准 |

**源码阅读规则**

- 不要从第一行开始读。先画请求生命周期，再找三个入口：调度、KV、指标。
- 每读一个文件，问：它的输入/输出是什么？哪个不变量不能破？
- 看到复杂分支，先写一个最小复现实验，再回读。
- 不要复制大段代码；理解后用自己的数据结构实现。

---

## 3. 系统与数学基础

不需要成为排队论专家，但要掌握：

- **Little's Law**：`L = λW`；平均并发 = 到达率 × 平均停留时间。
- **利用率**：`ρ = λ / μ`；接近 1 时队列与尾延迟非线性上升。
- **M/M/1 直觉**：单服务台、随机到达；理解“为什么过载后延迟爆炸”。
- **分位数**：P50/P95/P99；均值掩盖尾部。
- **Roofline**：计算/内存带宽瓶颈；decode 常受带宽限制。

可选阅读：

- *Systems Performance*（Brendan Gregg）：第 1–2 章的方法论，足够用于本项目。
- *Designing Data-Intensive Applications*：排队、复制、尾延迟相关章节，选读。
- MIT 6.172 / 6.824 的公开材料：性能工程、分布式系统基础，选读，不要一次性刷完。

---

## 4. 工具

| 工具 | 用途 |
| --- | --- |
| `pnpm demo` / `pnpm bench` | 本项目 CLI 实验 |
| `pnpm test` / Vitest / fast-check | 单元、属性、UI 测试 |
| Chrome DevTools Performance | 前端 trace、长任务、主线程阻塞 |
| Instruments（macOS） | CPU/内存/Metal 分析；需要 GUI 与权限 |
| `hyperfine` | CLI 命令计时；注意 warm-up 与重复 |
| `jq` | 查看 benchmark JSON、比较 cell |
| Git | 每次实验一个 commit，保留可复现历史 |

---

## 5. 小模型校准准备（后续阶段，不要现在执行）

目标：用一台 Apple Silicon / 16 GB 机器，得到**一组可信的 prefill/decode 曲线**，
用于校准模拟参数；不是做生产 benchmark。

候选模型（按许可证与大小自选）：

- Qwen2.5-0.5B / 1.5B Instruct（4-bit）
- Llama 3.2 1B（注意许可证）
- Gemma 2 2B（注意许可证）

候选 runtime：

- llama.cpp（Metal）
- MLX / mlx-lm
- Ollama（方便，但控制粒度较弱）

测量设计：

1. 固定输出长度，改变 prompt 长度，测 prefill；
2. 固定 prompt，改变 batch，测 decode step；
3. warm-up 3 次，重复 5 次，取中位数与离散度；
4. 记录模型、量化、机器、OS、runtime 版本、功耗/温度状态；
5. 拟合 `prefillMsPerToken` 与 `decodeMsPerRequest`，生成独立 profile；
6. 在报告中同时保留 `synthetic-v1` 与 `measured`，不要静默替换默认值。

**诚实边界**：单机、单模型、短时间测量；不能代表生产吞吐或硬件排名。

---

## 6. 一份够用的 8 周阅读安排

| 周 | 阅读 | 时间 |
| --- | --- | ---: |
| 1 | Orca + 本项目 ARCHITECTURE | 4h |
| 2 | PagedAttention + `kv-cache.ts` | 4h |
| 3 | Sarathi-Serve（chunked prefill） | 3h |
| 4 | SGLang / RadixAttention + prefix 代码 | 4h |
| 5 | vLLM scheduler 源码选读 | 4h |
| 6 | preemption / admission 相关资料 + 设计文档 | 3h |
| 7 | llama.cpp / MLX 测量文档 | 4h |
| 8 | 复盘 + 面试表达，不读新论文 | 2h |

如果某周只有 15 小时，阅读不要超过 4 小时；剩下时间必须动手。

---

## 7. 不要做的事

- 不要为了“追新”同时读五个 serving 框架；先把一个请求生命周期吃透。
- 不要只看视频/博客，不写代码；一周至少一个实验。
- 不要把论文里的 H100 数字套到 Mac 上。
- 不要在没有记录硬件/模型/版本的情况下声称“实测”。
- 不要用真实模型替代模拟器；两者是互补关系。
