#!/usr/bin/env python3
"""Send a fixed burst of requests to a running llama-server and time each one.

Usage:
    llama-server -m models/qwen2.5-0.5b-instruct-q4_k_m.gguf \
        -c 16384 -ngl 99 -np 8 --port 8099
    python3 docs/learning/notes/tools/drive-burst.py > burst-real.json

The request set is deterministic: 24 requests, eight each at 128/512/1024 prompt
tokens and 64 output tokens, all released at once. Each worker streams the
response so client-side TTFT is measured, not inferred from server timings.
"""
import http.client, json, threading, time, statistics

HOST, PORT = "127.0.0.1", 8099
FILLER = "The quick brown fox jumps over the lazy dog while the engineer measures tokens per second. "

def make_prompt(target_tokens: int) -> str:
    # ~17 tokens per sentence; close enough, and the exact count is reported.
    repeats = max(1, target_tokens // 17)
    return (FILLER * repeats).strip() + "\n\nSummarize the sentence above in one short line."

def one(out, idx, spec, barrier):
    body = json.dumps({
        "prompt": spec["prompt"], "n_predict": spec["max_new_tokens"],
        "temperature": 0, "cache_prompt": False, "stream": True,
    }).encode()
    conn = http.client.HTTPConnection(HOST, PORT, timeout=300)
    barrier.wait()
    t0 = time.monotonic()
    conn.request("POST", "/completion", body,
                 {"Content-Type": "application/json", "Accept": "text/event-stream"})
    resp = conn.getresponse()
    first = None
    n = 0
    buf = b""
    while True:
        raw = resp.read1(4096)
        if not raw:
            break
        buf += raw
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            if not line.startswith(b"data: "):
                continue
            if line[6:] == b"[DONE]":
                break
            try:
                obj = json.loads(line[6:])
            except json.JSONDecodeError:
                continue
            if obj.get("content"):
                if first is None:
                    first = time.monotonic()
                n += 1
    t1 = time.monotonic()
    conn.close()
    out[idx] = {
        "id": spec["id"], "prompt_tokens_target": spec["prompt_tokens"],
        "output_tokens": n,
        "ttft_ms": (first - t0) * 1000 if first else None,
        "tpot_ms": ((t1 - first) / (n - 1) * 1000) if first and n > 1 else None,
        "e2e_ms": (t1 - t0) * 1000,
    }

def main():
    specs = []
    for i in range(24):
        prompt_tokens = (128, 512, 1024)[i % 3]
        specs.append({
            "id": f"r{i:02d}",
            "prompt_tokens": prompt_tokens,
            "prompt": make_prompt(prompt_tokens),
            "max_new_tokens": 64,
        })

    # Warm-up so the first request does not pay GPU ramp-up.
    one([{}], 0, specs[0], threading.Barrier(1))

    out = [None] * len(specs)
    barrier = threading.Barrier(len(specs))
    threads = [
        threading.Thread(target=one, args=(out, i, spec, barrier))
        for i, spec in enumerate(specs)
    ]
    t_start = time.monotonic()
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    makespan = time.monotonic() - t_start

    rows = [r for r in out if r]
    summary = {
        "source": "llama-server (real)",
        "requests": len(rows),
        "makespan_s": makespan,
        "ttft_ms": {"p50": statistics.median(r["ttft_ms"] for r in rows)},
        "tpot_ms": {"p50": statistics.median(r["tpot_ms"] for r in rows)},
        "per_request": rows,
    }
    print(json.dumps(summary, indent=2))

if __name__ == "__main__":
    main()
