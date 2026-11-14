# Calibration 01 — Qwen2.5-0.5B 吞吐预测（预注册）

- 日期：2026-11-13
- 状态：**预测，尚未测量。** 本文所有"tok/s"都是解析估算，不是硬件测量结果。
- 关联概念：[Prefill / Decode / KV Cache](../CONCEPTS.md)、Roofline、量化、batch
- 对应任务：`TASKS.md` M6 — "Optional small-model calibration profile on Apple Silicon"
- 最终产出：本文件是 `calibration-01.md`（实测报告）的**预注册**。测完不要改本文，把结果写进
  `experiment-XX.md`，让"预测 vs 实际"的差异成为证据。

## 0. 一句话

在 16 GB M5 MacBook Air（8 核 GPU、153 GB/s）上，Qwen2.5-0.5B-Instruct Q4_K_M 的 decode 应该是
**~200 tok/s 单流**、prefill **~900 tok/s**、聚合吞吐在 **b≈7 处撞到 ~1200 tok/s 的算力天花板**。
如果实测偏离超过 30%，说明我对某个机制的理解是错的——那比数字本身更有价值。

> 为什么先写预测：这个项目全部数字都来自 `synthetic-v1` 合成成本模型。接入真机时，最容易犯的错
> 是"先看到数字，再编一套解释"。预注册把解释权交给测量结果。

---

## 1. 机器指纹（测量当天需重新采集并写进报告）

| 项 | 值 |
| --- | --- |
| 机型 | MacBook Air `Mac17,3`（Apple M5，无风扇） |
| CPU | 10 核（4 性能 + 6 能效） |
| GPU | **8 核**、Metal 4 |
| 统一内存 | 16 GiB（LPDDR5X，153 GB/s） |
| OS | macOS 27.3（26C5035r） |
| Node / pnpm | v24.22.2 / 12.18.0 |
| llama.cpp | 0.9.0，build 12110，commit `cd959bae9`（Homebrew，Metal 后端在 `libexec/libggml-metal.so`） |
| 电源 | AC（电池电量会影响功耗墙，测量时必须固定状态） |

> ⚠️ 这是 **8 核 GPU** 的 Air，不是 10/16 核的 M5 Pro/Max。本文所有结论不可外推到那些机器。

---

## 2. 模型与量化

Qwen2.5-0.5B-Instruct（`Qwen/Qwen2.5-0.5B-Instruct`）：`d_model=896`、`L=24`、14 attention heads、
**2 KV heads**、`head_dim=64`、`FFN=4864`、`vocab=151936`、embedding 与 lm_head 共享。

| 量 | 值 | 算法 |
| --- | --- | --- |
| 参数量 | **0.494 B** | `V·d + L·(2d² + 2d·H_kv·d_head + 3d·F)` |
| KV / token | **12.0 KiB**（fp16） | `2 × 24 × 2 × 64 × 2 B` |
| KV @ 4k / 32k | 48 MiB / **384 MiB** | 乘 token 数 |
| 权重 Q4_K_M | **~0.40 GB** | ≈4.85 bpw + 输出层 q6_K |
| 权重 Q8_0 | ~0.53 GB | 8.5 bpw |
| 权重 F16 | ~0.99 GB | 16 bpw |

**第一个结论**：0.5B 在 16 GB 上完全不缺内存（权重 0.4 GB + 32k 上下文 0.38 GB）。
限制它的是**带宽**，不是容量——这正好是本项目的论点，但也意味着项目里那套
`kv.totalBlocks` 容量压力实验，在 0.5B 上会"空转"（见 §9）。

---

## 3. 估算模型（可复算）

```text
decode  t_step ≈ max( (W + B × ctx × KV_per_token) / BW_eff ,  2·N·B / FLOPS_eff )
prefill t_pp   ≈ t_pp_intercept + tokens × 2·N / FLOPS_eff
```

参数取值与依据：

| 参数 | 取值 | 依据 |
| --- | --- | --- |
| `BW_peak` | 153 GB/s | Apple 官方 M5 规格 |
| `BW_eff` | 69–92 GB/s（45–60% of peak） | 见下 |
| `FLOPS_eff` | 0.65–1.20 TFLOPS | 0.5B 的瘦 GEMM，远低于峰值 |
| `t_pp_intercept` | 8–25 ms | kernel dispatch + buffer 初始化 |

**已测的一个数（属于本机，但不属于 GPU）**：8 线程流式读 512 MiB，3 次重复得 **117 / 102 / 118 GB/s**，
即峰值的 ~77%。CPU 侧能到这个数，说明 153 GB/s 的规格不是纸面数字；但 GPU 上跑 24 层小模型的 GEMV
远达不到，所以按 45–60% 取。

复现脚本（纯算术，无依赖）：

```python
d, L, KVH, hd, F, V = 896, 24, 2, 64, 4864, 151936
N = V*d + L*(2*d*d + 2*d*KVH*hd + 3*d*F)      # 0.494 B
KVt = 2*L*KVH*hd*2                             # 12288 B/token
BW, FL = 153e9*0.525, 1.2e12                   # mid 有效带宽 / 有效算力
W = 0.40e9
step = lambda B, ctx: max((W + B*ctx*KVt)/BW*1e3, 2*N*B/FL*1e3)  # ms
```

---

## 4. 预测表

### 4.1 单流 decode（batch = 1，ctx 512）

| 量化 | 权重 | 低效 45% | **中值 52.5%** | 高效 60% | ctx 8k（中值） |
| --- | ---: | ---: | ---: | ---: | ---: |
| Q4_K_M | 0.40 GB | 169 | **198** | 226 | 160 |
| Q8_0 | 0.53 GB | 128 | **150** | 171 | 127 |
| F16 | 0.99 GB | 69 | **81** | 92 | 74 |

单位 tok/s。**只看一个数**：Q4_K_M ≈ **190–230 tok/s**，即 ~4.5–5.5 ms/token。

### 4.2 Prefill 曲线（Q4_K_M）

| prompt tokens | 32 | 128 | 512 | 1024 | 2048 | 8192 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 预测 tok/s | 430–940 | 700–950 | 750–1050 | 800–1100 | 820–1150 | 820–1150 |
| 中值 | ~640 | ~820 | ~886 | ~897 | ~903 | ~907 |

即 **~1.1 ms/token**（0.8–1.5）。注意 pp32 明显掉速：固定开销占比大。

### 4.3 batch × ctx（Q4_K_M，单位：聚合 tok/s；括号为瓶颈）

| ctx \ b | 1 | 2 | 4 | 8 | 16 | 32 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 512 | 198 (M) | 389 (M) | 756 (M) | **1215 (C)** | 1215 (C) | 1215 (C) |
| 1024 | 195 (M) | 378 (M) | 713 (M) | 1215 (C) | 1215 (C) | 1215 (C) |
| 4096 | 178 (M) | 321 (M) | 534 (M) | 801 (M) | 1066 (M) | 1215 (C) |
| 8192 | 160 (M) | 267 (M) | 400 (M) | 533 (M) | 639 (M) | 710 (M) |

M = 带宽瓶颈，C = 算力瓶颈。对应每请求 TPOT：

| ctx \ b | 1 | 4 | 8 | 16 |
| --- | ---: | ---: | ---: | ---: |
| 512 | 5.1 ms | 5.3 ms | **6.6 ms** | 13.2 ms |
| 4096 | 5.6 ms | 7.5 ms | 10.0 ms | 15.0 ms |

**三个可检验的结构性预测**：

1. 短上下文时 batch 收益在 **b≈7** 处停住（算力天花板），之后聚合并吞吐不再增长，只是把延迟堆上去；
2. 长上下文时天花板右移（4k 约 b≈25，8k 在 b≤32 内不出现），因为 KV 读取重新变成主要成本；
3. 所以"最优 batch"是**上下文的函数**，不是一个常数——这正是 vLLM 里 `max_num_batched_tokens`
   需要按场景调的原因。

### 4.4 三个端到端请求（Q4_K_M，单流，含排队 0）

| 请求 | TTFT | TPOT | 总时长 |
| --- | ---: | ---: | ---: |
| prompt 128 / out 128 | ~0.16 s | 5.2 ms | ~0.82 s |
| prompt 800 / out 256 | ~0.90 s | 5.2 ms | ~2.2 s |
| prompt 4096 / out 256 | ~4.5 s | 5.6 ms | ~5.9 s |

**反直觉点**：0.5B 并不"瞬间响应"。800 token 的 prompt 就要接近 1 秒 TTFT——因为 prefill 是
算力瓶颈，而 8 核 GPU 的有效算力只有 ~1 TFLOPS。

---

## 5. 拟合出的 profile 会长什么样（对 `synthetic-v1` 的预测偏差）

`src/core/config.ts` 默认值（注释明确说是 7B 4-bit 量级），预测的实测拟合值（ctx=1024, Q4_K_M）：

| 参数 | `synthetic-v1` | 预测 `measured-m5-q4-0.5b` | 偏差 |
| --- | ---: | ---: | --- |
| `prefillMsPerToken` | 0.35 | **1.10**（0.85–1.40） | 慢 3.1× |
| `prefillBaseMs` | 2 | **15**（5–30） | 偏小 7× |
| `decodeBaseMs` | 18 | **5.0**（4.4–5.8） | 快 3.6× |
| `decodeMsPerRequest` | 1.2 | **0.16**（0.13–0.18）@1k ctx | 快 7.5× |
| `stepOverheadMs` | 0.2 | **0.4**（0.25–0.8） | 偏小 |

**最重要的不是绝对值，而是比例翻转**：默认模型里 1 个 prompt token ≈ 1/51 个 decode step；
0.5B 实测会变成 ≈ 1/4.5。也就是说**在小模型上 prefill 相对贵 11 倍**。这会让
`prefillChunkSize`、准入控制、长 prompt 的优先级策略，全都比原来更重要——而这些结论是从
"违和感"里长出来的，不是从 tok/s 里。

⚠️ `decodeBaseMs` 与 `stepOverheadMs` 在单点测量里**不可辨识**。分离方法：用 `-d 0` 与 `-d 4096`
两点求斜率得到 KV 成本，截距才是 `weights + overhead`，再与 §3 的理论权重时间相减。

---

## 6. 可证伪假设（跑之前写死）

| # | 假设 | 判定标准 | 若失败说明什么 |
| --- | --- | --- | --- |
| H1 | decode 是字节瓶颈 | `tg(Q8)/tg(Q4)` ∈ [1.15, 1.45]（预测 1.33） | ≈1.0 说明不是带宽瓶颈，整个 roofline 叙事要重写 |
| H2 | batch 收益次线性 | ctx512 下 `agg(b=8)/agg(b=1)` ∈ [4.5, 8]（预测 6.1） | <3 说明有别的串行开销（采样、调度、拷贝） |
| H3 | 短上下文存在算力天花板 | `agg(b=16)/agg(b=8)` ∈ [0.9, 1.15] | >1.5 说明有效算力更高（M5 神经加速器可能真被用上了） |
| H4 | decode 随上下文衰减 | `tg(d=8192)/tg(d=0)` ∈ [0.70, 0.90]（预测 0.80） | ≈1.0 说明注意力 KV 读被高效 kernel 掩盖 |
| H5 | prefill 线性 + 截距 | pp512–8192 线性拟合 R²>0.98；斜率 0.8–1.5 ms/token | 斜率过低说明算力估计偏保守；非线性说明 chunk 策略有效 |
| H6 | 端到端 | TTFT(800) ∈ [0.7, 1.2] s；TPOT ∈ [4.5, 6.0] ms | 偏离说明 §3 的模型缺项 |

预测误差带：**±30%**。超出即触发复盘，而不是"调参到对上"。

---

## 7. 测量协议（尚未执行）

**前置**：接 AC 电源、关闭低电量模式、退出其它 GPU 应用、关闭屏幕休眠；每组之间冷却 60 s
（Air 无风扇，持续负载会降频）；单次测量 ≤60 s。

> 实测踩坑提示：本机首次运行 llama.cpp 时会编译 Metal pipeline（`ggml_metal_library_compile_all`，
> 本次探测耗时约 30 s）。**先空跑一次丢弃**，否则第一组数字会被编译时间污染。

```bash
# 0. 指纹与版本（必须写进报告）
sw_vers; pmset -g batt
system_profiler SPHardwareDataType | head -20
llama-cli --version

# 1. 取模型（~400 MB，文件名以 HF 仓库为准）
#    Qwen/Qwen2.5-0.5B-Instruct-GGUF -> *q4_k_m.gguf（可选再取 q8_0 / f16 做 H1）

# 2. decode 基线（tg）
llama-bench -m models/qwen2.5-0.5b-instruct-q4_k_m.gguf -p 0 -n 128 -r 5 -ngl 99

# 3. prefill 曲线（pp）
llama-bench -m models/qwen2.5-0.5b-instruct-q4_k_m.gguf -p 32,128,512,1024,2048,8192 -n 0 -r 3 -ngl 99

# 4. 上下文衰减（H4）：同一 tg，改变 depth
llama-bench -m models/qwen2.5-0.5b-instruct-q4_k_m.gguf -p 0 -n 128 -d 0,1024,4096,8192 -r 3 -ngl 99

# 5. 批量（H2/H3）：并行 slot，聚合吞吐
llama-batched-bench -m models/qwen2.5-0.5b-instruct-q4_k_m.gguf \
  -c 32768 -b 2048 -ub 512 -npp 512 -ntg 128 -npl 1,2,4,8,16

# 6. 量化对照（H1）：同一组命令换 q8_0 / f16
```

记录项：每次运行的 `model / quant / ngl / b / ub / depth / r`、中位数与离散度、温度与功耗状态
（`sudo powermetrics --samplers smc -i 1000 -n 10`，可选）、当时是否插电。

---

## 8. 结果登记（测量后填写，本文其余部分不改）

> 结果与完整分析见 [`calibration-01.md`](calibration-01.md)（2026-11-14）。

| 假设 | 预测 | 实测 | 偏差 | 判定 |
| --- | --- | --- | --- | --- |
| H1 量化比 | 原式 Q8/Q4，1.33 | 0.783（倒数为 1.277） | 原预测比值方向写反 | ❌ |
| H2 b=8 加速比 | 6.1× | 4.82× | −21% | 本轮区间内，缺少重复 |
| H3 天花板 | 持平 | b16/b8=1.19，b32/b16=0.93 | +19% | 本轮超出区间 |
| H4 8k 衰减 | 0.80× | 0.736× | −8% | ✅ |
| H5 prefill 斜率 | 1.1 ms/tok | 512→2048 增量斜率约 0.167 ms/tok | −85% | ❌ |
| H6 TTFT(800) | 0.9 s | 未采集客户端首 token 时间 | — | 未验证 |

实测后核对发现，事前预测还包含未经验证的硬件归因与容量判断；原文保留作为预测记录，
应以实测报告的证据边界与纠正为准。

原始输出：`llama-bench -o json` 存到 `docs/learning/notes/data/`，不要只留截图。

---

## 9. 诚实边界

- **单机、单模型、单量化、短时测量**：不代表生产吞吐，也不是硬件排名。
- **0.5B 不可外推到 7B+**：参数变大后算力/带宽比改变，拐点位置完全不同。
- **0.5B 无法检验 KV 容量压力**：32k 上下文只占 384 MiB。想复现项目里的 paged-KV 压力场景，
  必须人为把模拟侧 `kv.totalBlocks` 调小（如 512），或换 7B 级模型（KV ~56 KiB/token，
  4-bit 权重 ~4.4 GB，8 个 32k 上下文的请求才会真的开始抢内存）。
- **合成模型不会被"静默替换"**：实测值只能作为独立 profile（`measured-m5-q4-0.5b`）与
  `synthetic-v1` 并存，报告里两者同时出现。这是 `README.md` 已声明的立场。
- **无风扇**：持续负载下数字会下降。报告必须写清每次测量的时长与顺序。

---

## 10. 如果预测错了，最可能错在哪（按概率排序）

1. **Metal 上 24 层小模型的 GEMV 效率**：每层都要 dispatch 一串 kernel，5 ms 的步长里固定开销
   占比可能远超 0.4 ms，导致实测 decode 明显低于 200 tok/s。
2. **8 核 GPU 的有效算力**：我按 ~1.2 TFLOPS 估；但本次探测发现 llama.cpp 0.9.0 的 Metal 后端已在
   `ggml_metal_device_init` 里**探测 tensor API**（f16 / bfloat 支持），说明它可能真的用上了 M5 的
   每核神经加速器。若如此，prefill 可能翻倍，H3/H5 会失败——这是目前不确定性最大的一项。
3. **GGUF 实际体积**：embedding/lm_head 是 136 M 参数（占 27%），llama.cpp 常把它留在 q6_K，
   实际文件可能到 0.45 GB，decode 相应慢 10%。
4. **热降频**：Air 无风扇，靠后的测量组系统性偏低——这也是为什么要求固定顺序和冷却时间。

> 一句话：**预测错了不是失败，没写预测才是。**

---

## 11. 下一步

- [ ] 待定：是否进入 M6 实测（本文只是准备，不承诺执行）。
- [ ] 若执行：先跑 H1 和 H6 两组（约 10 分钟），确认量级后再投入完整协议。
- [ ] 实测报告 → `calibration-01.md`；本文保留原样，作为对照。
