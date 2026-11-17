# Calibration 01 原始数据

2026-11-14，Apple M5 MacBook Air（8 核 GPU / 16 GiB），macOS 27.3，
llama.cpp 0.9.0 build 12110（Metal）。模型：Qwen2.5-0.5B-Instruct GGUF。

| 文件 | 内容 | 命令 |
| --- | --- | --- |
| `tg-q4.json` | Q4_K_M decode 基线，5 次重复 | `llama-bench -m q4 -p 0 -n 128 -r 5 -ngl 99 -o json` |
| `tg-q8.json` / `tg-fp16.json` | 同上，换量化 | 同上 |
| `pp-q4.json` | prefill 曲线（32→8192） | `llama-bench -m q4 -p 32,128,512,1024,2048,8192 -n 0 -r 3 -ngl 99 -o json` |
| `tg-depth-q4.json` | decode 随上下文衰减（到 8k） | `llama-bench -m q4 -p 0 -n 128 -d 0,1024,4096,8192 -r 3 -ngl 99 -o json` |
| `tg-depth-long-q4.json` | 补测到 30k：解码随上下文 | `llama-bench -m q4 -p 0 -n 128 -d 0,4096,8192,16384,30720 -r 3 -ngl 99 -o json` |
| `pp-long-q4.json` | 长 prompt prefill（16k / 30k） | `llama-bench -m q4 -p 16384,30720 -n 0 -r 2 -ngl 99 -o json` |
| `pp-at-depth-q4.json` | 512-token chunk 在长上下文上的 prefill | `llama-bench -m q4 -p 512 -n 0 -d 0,8192,16384,30720 -r 3 -ngl 99 -o json` |
| `tg-q4-cpu.json` / `pp-q4-cpu.json` | CPU 对照（`-ngl 0`） | 同上，去掉 `-ngl 99` 加 `-ngl 0` |
| `batched-q4.txt` | 批次 1/2/4/8/16，`-c 32768`，**先测、偏慢的一轮** | `llama-batched-bench ... -c 32768 -npp 512 -ntg 128 -npl 1,2,4,8,16` |
| `batched-q4-32.txt` | 批次 1/8/16/32，`-c 65536`，**报告采用的一轮** | 同上，`-c 65536 -npl 1,8,16,32` |
| `burst-real.json` | 同上的**首次**运行（冷启动，4.27 s，明显偏慢，仅作对照） | 同上 |
| `burst-real-1/2/3.json` | 24 请求突发的真实客户端计时（预热后 3 次） | [`tools/drive-burst.py`](../tools/drive-burst.py) |
| `burst-sim.json` | 同一负载在模拟器里的 FCFS / 连续批处理结果 | [`tools/run-burst-sim.ts`](../tools/run-burst-sim.ts) |
| `server-concurrency.json` | 16 并发下的 TTFT/TPOT/聚合吞吐（客户端 + 服务端两路） | [`tools/measure-concurrency.py`](../tools/measure-concurrency.py) |
| `server-timings.json` | 手动保存的服务内部 prompt 计时摘要、prefix cache；不是客户端 TTFT | 见[报告 §6](../calibration-01.md#6-服务端-prompt-计时与前缀复用) |

JSON bench 文件是工具原始输出（逐字节保留，不经格式化），server-timings 是响应字段的摘要，
完整响应未保存。`biome.json` 特意把本目录排除在格式/静态检查之外：这里的数字应当保持
测量工具打印时的原样，任何自动格式化都等于改动证据。
上表命令中的 q4 是模型路径占位符；batched 两轮均使用 `-b 2048 -ub 512`。

两轮 batched 的 b=1 基线分别是 198.9 与 228.4 tok/s（差约 15%）。
配置、运行顺序和系统状态未被控制；没有温度或频率记录，不能确定差异是否来自热降频。
本次在矩阵开始前做过一次 warm-up，没有逐组执行固定冷却和独立 warm-up。
