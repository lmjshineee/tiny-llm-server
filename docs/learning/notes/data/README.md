# Calibration 01 原始数据

2026-11-14，Apple M5 MacBook Air（8 核 GPU / 16 GiB），macOS 27.3，
llama.cpp 0.9.0 build 12110（Metal）。模型：Qwen2.5-0.5B-Instruct GGUF。

| 文件 | 内容 | 命令 |
| --- | --- | --- |
| `tg-q4.json` | Q4_K_M decode 基线，5 次重复 | `llama-bench -m q4 -p 0 -n 128 -r 5 -ngl 99 -o json` |
| `tg-q8.json` / `tg-fp16.json` | 同上，换量化 | 同上 |
| `pp-q4.json` | prefill 曲线（32→8192） | `llama-bench -m q4 -p 32,128,512,1024,2048,8192 -n 0 -r 3 -ngl 99 -o json` |
| `tg-depth-q4.json` | decode 随上下文衰减 | `llama-bench -m q4 -p 0 -n 128 -d 0,1024,4096,8192 -r 3 -ngl 99 -o json` |
| `tg-q4-cpu.json` / `pp-q4-cpu.json` | CPU 对照（`-ngl 0`） | 同上，去掉 `-ngl 99` 加 `-ngl 0` |
| `batched-q4.txt` | 批次 1/2/4/8/16，`-c 32768`，**先测、偏慢的一轮** | `llama-batched-bench ... -c 32768 -npp 512 -ntg 128 -npl 1,2,4,8,16` |
| `batched-q4-32.txt` | 批次 1/8/16/32，`-c 65536`，**报告采用的一轮** | 同上，`-c 65536 -npl 1,8,16,32` |
| `server-timings.json` | 手动保存的服务内部 prompt 计时摘要、prefix cache；不是客户端 TTFT | 见[报告 §6](../calibration-01.md#6-服务端-prompt-计时与前缀复用) |

JSON bench 文件是工具原始输出；server-timings 是响应字段的摘要，完整响应未保存。
上表命令中的 q4 是模型路径占位符；batched 两轮均使用 `-b 2048 -ub 512`。

两轮 batched 的 b=1 基线分别是 198.9 与 228.4 tok/s（差约 15%）。
配置、运行顺序和系统状态未被控制；没有温度或频率记录，不能确定差异是否来自热降频。
本次在矩阵开始前做过一次 warm-up，没有逐组执行固定冷却和独立 warm-up。
