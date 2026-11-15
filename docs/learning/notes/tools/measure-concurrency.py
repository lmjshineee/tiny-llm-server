#!/usr/bin/env python3
"""Measure concurrent-serving throughput against a running llama-server.

Usage:
    llama-server -m models/qwen2.5-0.5b-instruct-q4_k_m.gguf \
        -c 16384 -ngl 99 -np 16 --port 8099
    python3 docs/learning/notes/tools/measure-concurrency.py

Fires N simultaneous streaming requests (N = 1, 2, 4, 8, 16), 521-token prompt,
128 output tokens, temperature 0, prompt cache disabled, then reports aggregate
decode throughput, client-side TTFT, per-request TPOT and wall clock.

Requires only the Python standard library. The 2026-11-14 run is recorded in
docs/learning/notes/data/server-concurrency.json.
"""
import http.client, json, threading, time, statistics

HOST, PORT = "127.0.0.1", 8099
FOX = ("The quick brown fox jumps over the lazy dog while the engineer measures tokens per second. " * 30).strip()
PROMPT = FOX + "\n\nSummarize the sentence above in one short line."

def one(out, idx, barrier):
    body = json.dumps({
        "prompt": PROMPT, "n_predict": 128, "temperature": 0,
        "cache_prompt": False, "stream": True,
    }).encode()
    conn = http.client.HTTPConnection(HOST, PORT, timeout=180)
    barrier.wait()
    t0 = time.monotonic()
    conn.request("POST", "/completion", body,
                 {"Content-Type": "application/json", "Accept": "text/event-stream"})
    resp = conn.getresponse()
    first = None; n = 0; buf = b""
    while True:
        raw = resp.read1(4096)
        if not raw: break
        buf += raw
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            if not line.startswith(b"data: "): continue
            if line[6:] == b"[DONE]": break
            try: obj = json.loads(line[6:])
            except json.JSONDecodeError: continue
            piece = obj.get("content") or ""
            if piece:
                if first is None: first = time.monotonic()
                n += 1
    t1 = time.monotonic()
    conn.close()
    out[idx] = {"t0": t0, "first": first, "t1": t1, "n": n}

def run(n):
    out = [None] * n
    barrier = threading.Barrier(n)
    ths = [threading.Thread(target=one, args=(out, i, barrier)) for i in range(n)]
    for t in ths: t.start()
    for t in ths: t.join()
    tokens = sum(r["n"] for r in out)
    decode_span = max(r["t1"] for r in out) - min(r["first"] for r in out)
    ttft = statistics.mean(r["first"] - r["t0"] for r in out)
    tpot = statistics.mean((r["t1"] - r["first"]) / (r["n"] - 1) for r in out)
    wall = statistics.mean(r["t1"] - r["t0"] for r in out)
    return {"n": n, "agg_decode": tokens / decode_span, "ttft_ms": ttft * 1000,
            "tpot_ms": tpot * 1000, "wall_ms": wall * 1000, "tokens": tokens}

run(1)
rows = [run(n) for n in (1, 2, 4, 8, 16)]
print(f'{"batch":>5} {"agg decode tok/s":>17} {"TTFT ms":>9} {"TPOT ms":>8} {"per-req wall ms":>16}')
for r in rows:
    print(f'{r["n"]:5d} {r["agg_decode"]:17.1f} {r["ttft_ms"]:9.1f} {r["tpot_ms"]:8.2f} {r["wall_ms"]:16.0f}')
json.dump(rows, open("/tmp/conc2-results.json", "w"), indent=2)
