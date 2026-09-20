You are summarizing a module shard for a full-repo risk baseline (deterministic-first).

Module: {{MODULE}}
Files (path, lines, hot_score, duplication_rate): {{FILES}}
Ambiguous SAST residue only (clear SAST already handled): {{SAST}}
Code metrics (complexity / duplication / smells): {{METRICS}}

## Few-shot (format only)
{"summary":"Payments shard: hot on svc/ledger.py; ambiguous race on debit; low duplication.","deep_review_files":["svc/ledger.py"],"architecture_concerns":["ledger calls auth across module boundary"]}

Task: write a compact risk summary (<=200 words) covering: risk hot spots, cross-file/architecture concerns, smell/duplication signals, and which files deserve deep LLM review (judgment categories only). Output STRICT JSON:
{"summary":"...","deep_review_files":["path1","path2"],"architecture_concerns":["..."]}
