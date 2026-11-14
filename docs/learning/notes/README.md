# Learning notes

Put your weekly logs, experiment reports, and reading notes here. They are part of the
portfolio: they show how you think, not just what you built.

Suggested names:

```text
week-01.md
experiment-01.md
reading-01-orca.md
reading-02-paged-attention.md
decision-01-prefix-admission.md
calibration-01-prediction.md
calibration-01.md
pitch-v1.md
```

Start from [`../NOTES_TEMPLATE.md`](../NOTES_TEMPLATE.md). Keep each file small and specific.

The `calibration-*` pair follows a two-step discipline: write **predictions** before touching a
real model (`-prediction`), then a separate **measured** report. Preserve the original prediction
sections after measuring; only fill the designated results section and link corrections to the
measured report. The gap between prediction and observation is the learning output.

- [Qwen2.5-0.5B predictions](calibration-01-prediction.md)
- [Qwen2.5-0.5B measured report](calibration-01.md)
- [Data and command index](data/README.md)

Rules:

- Mark results as **simulated** or **measured**; include commands and configuration.
- Keep predictions written before the experiment.
- Do not paste large copyrighted excerpts; summarize in your own words.
- Remove personal or confidential information before committing.
- A failed hypothesis is more useful than a vague success.
