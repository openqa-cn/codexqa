#!/usr/bin/env python3
"""Blast-radius risk tier from pack paths + tags + sensitive + rollout surfaces.

Writes JSON body consumed by derive-risk-tier.sh. Zero CodexQA calls.
T0 = highest blast (auth/pay/migration/IaC). Highest file tier wins; escalate on uncertainty.
"""
from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _line_scan import is_heuristic_meta_line  # noqa: E402

# Path families (ShipWithAI-aligned T0 surfaces)
IAC_PATH = re.compile(
    r"(?i)("
    r"\.tf$|\.tfvars$|terraform/|cloudformation/|pulumi/|cdk/|"
    r"helm/|charts/|k8s/|kubernetes/|kustomize/|"
    r"Dockerfile|docker-compose|\.github/workflows/|"
    r"/iam/|iam_|infra/|deploy/"
    r")"
)
MIGRATION_PATH = re.compile(
    r"(?i)(db/migrate|flyway|liquibase|prisma/migrations|alembic/versions|"
    r"migrations?/|schema\.prisma|changelog.*\.xml|V\d+__)"
)
AUTH_PATH = re.compile(
    r"(?i)(/auth/|/oauth|/oidc|/sso/|/jwt|/rbac|/acl/|"
    r"authentication|authorization|middleware.*auth|"
    r"/security/|passwd|password|credential)"
)
PAY_PATH = re.compile(
    r"(?i)((^|/)(pay(ment)?s?|billing|wallet|ledger)(/|$)|"
    r"checkout.*charge|refund|stripe|paypal)"
)
# Core business paths → at least T1 when not T0 (plan: 核心业务路径)
CORE_BIZ_PATH = re.compile(
    r"(?i)((^|/)(services?|domain|core|business|application)(/|$))"
)
TEST_DOCS_PATH = re.compile(
    r"(?i)(^|/)(docs?/|fixtures?/|testdata/|__tests__/|tests?/|"
    r".*\.(md|markdown|txt|rst)$|"
    r".*[._](test|spec)\.[^/]+$|"
    r".*_test\.[^/]+$|"
    r"README|CHANGELOG|LICENSE|OWNERS|CODEOWNERS$|"
    r"\.editorconfig|\.gitignore|\.prettierrc|\.eslintrc)"
)
ENTRY_TAG = re.compile(
    r"(?i)(http|rpc|grpc|mq|queue|kafka|consumer|controller|"
    r"handler|endpoint|servlet|route|job|cron|task|entry)"
)
SENSITIVE_HINT = re.compile(r"(?i)\b(password|passwd|secret|token|auth|pay|bearer|api[_-]?key)\b")

TIER_RANK = {"T0": 0, "T1": 1, "T2": 2, "T3": 3}
INDUSTRY = {"T0": "Tier3", "T1": "Tier2", "T2": "Tier1", "T3": "Tier1"}


def load_json(path: str) -> dict | list | None:
    if not path or not os.path.isfile(path):
        return None
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError):
        return None


def extract_paths(files_obj) -> list[str]:
    paths: list[str] = []
    if not files_obj:
        return paths
    if isinstance(files_obj, dict):
        nodes = files_obj.get("nodes") or files_obj.get("files") or []
        if isinstance(nodes, list):
            for n in nodes:
                if isinstance(n, dict):
                    p = n.get("path") or n.get("file") or n.get("name")
                    if p:
                        paths.append(str(p))
                elif isinstance(n, str):
                    paths.append(n)
        elif isinstance(files_obj.get("paths"), list):
            paths.extend(str(p) for p in files_obj["paths"])
    elif isinstance(files_obj, list):
        for n in files_obj:
            if isinstance(n, dict):
                p = n.get("path") or n.get("file")
                if p:
                    paths.append(str(p))
            elif isinstance(n, str):
                paths.append(n)
    # dedupe preserve order
    seen = set()
    out = []
    for p in paths:
        if p not in seen:
            seen.add(p)
            out.append(p)
    return out[:200]


def classify_path(rel: str) -> tuple[str, str, list[str]]:
    """Return (tier, family, reasons). Highest-blast families first; docs/tests before auth/pay name collisions."""
    if IAC_PATH.search(rel):
        return "T0", "iac", ["iac_path"]
    if MIGRATION_PATH.search(rel):
        return "T0", "migration", ["migration_path"]
    # Docs/tests/fixtures win over auth/pay substrings in filenames (plan: docs/tests → T3)
    if TEST_DOCS_PATH.search(rel):
        return "T3", "test_docs", ["test_or_docs_path"]
    if AUTH_PATH.search(rel):
        return "T0", "auth", ["auth_path"]
    if PAY_PATH.search(rel):
        return "T0", "pay", ["pay_path"]
    if CORE_BIZ_PATH.search(rel):
        return "T1", "core_biz", ["core_business_path"]
    return "T2", "prod", ["production_path"]


def better(a: str, b: str) -> str:
    """Higher blast wins (lower numeric)."""
    return a if TIER_RANK.get(a, 3) <= TIER_RANK.get(b, 3) else b


def escalate(tier: str) -> str:
    """Move one step toward T0."""
    n = TIER_RANK.get(tier, 3)
    if n <= 0:
        return "T0"
    inv = {v: k for k, v in TIER_RANK.items()}
    return inv[n - 1]


def review_depth_for(tier: str) -> dict:
    floors = {
        "T0": {
            "evidence_floor": "full_checklist",
            "must_attempt_dimensions": ["all_registry"],
            "required_graph": True,
            "min_evidence_cites_per_finding": 2,
            "paired_review_recommended": True,
            "escalate_if": ["spot_check_fail", "stubs_high", "thin_pack", "new_t0_surface"],
        },
        "T1": {
            "evidence_floor": "trimmed_checklist",
            "must_attempt_dimensions": ["all_registry"],
            "required_graph": True,
            "min_evidence_cites_per_finding": 1,
            "paired_review_recommended": False,
            "escalate_if": ["spot_check_fail", "stubs_high", "new_t0_surface"],
        },
        "T2": {
            "evidence_floor": "spot_check",
            "must_attempt_dimensions": ["correctness", "security", "test_gaps"],
            "required_graph": False,
            "min_evidence_cites_per_finding": 1,
            "paired_review_recommended": False,
            "escalate_if": ["spot_check_fail", "new_t0_surface", "entry_reachable"],
        },
        "T3": {
            "evidence_floor": "sample_ci",
            "must_attempt_dimensions": [],
            "required_graph": False,
            "min_evidence_cites_per_finding": 0,
            "paired_review_recommended": False,
            "escalate_if": ["auth_pay_migration_iac_path", "sensitive_hit", "ci_red"],
        },
    }
    return floors.get(tier, floors["T1"])


def _normalize_tag_key(k) -> tuple[str, int]:
    """Return (key_name, repo_count). repo_count=-1 when unknown."""
    if isinstance(k, dict):
        key = str(k.get("key") or k.get("name") or k.get("tag") or "")
        rc = k.get("repo_count")
        try:
            rc_i = int(rc) if rc is not None else -1
        except (TypeError, ValueError):
            rc_i = -1
        return key, rc_i
    return str(k or ""), -1


def _count_tagged_nodes(obj) -> int:
    if not obj:
        return 0
    if isinstance(obj, list):
        return len(obj)
    if not isinstance(obj, dict):
        return 0
    for k in ("nodes", "symbols", "items", "results", "tagged"):
        v = obj.get(k)
        if isinstance(v, list):
            return len(v)
    res = obj.get("result")
    if res is not None:
        return _count_tagged_nodes(res)
    return 0


def _keys_catalog(tags_obj) -> list:
    keys = tags_obj.get("keys") if isinstance(tags_obj, dict) else None
    if isinstance(keys, dict):
        return keys.get("keys") or []
    if isinstance(keys, list):
        return keys
    return []


def tag_hits(tags_obj, pack_dir: str = "") -> list[dict]:
    """Entry-ish tags with real usages — not empty global key catalog rows.

    Collectors store ``tagged: [{key, file}]`` pointers. Matching catalog rows
    (often ``repo_count: 0``) or ``str(dict)`` dumps of those rows previously
    forced T1 on nearly every pack that listed framework.http in the schema.
    """
    hits = []
    if not tags_obj or not isinstance(tags_obj, dict):
        return hits

    key_counts: dict[str, int] = {}
    for k in _keys_catalog(tags_obj)[:80]:
        ks, rc = _normalize_tag_key(k)
        if ks:
            key_counts[ks] = rc

    tagged = tags_obj.get("tagged") or []
    if not isinstance(tagged, list):
        return hits
    for t in tagged[:50]:
        if not isinstance(t, dict):
            continue
        key = str(t.get("key") or t.get("tag") or t.get("name") or "")
        if not key or not ENTRY_TAG.search(key):
            continue
        file_ref = str(t.get("file") or t.get("path") or "")
        n_nodes = 0
        if pack_dir and file_ref:
            # file_ref is pack-relative (entries/tagged/….json)
            n_nodes = _count_tagged_nodes(load_json(os.path.join(pack_dir, file_ref)))
        elif t.get("nodes") or t.get("result"):
            n_nodes = _count_tagged_nodes(t)
        rc = key_counts.get(key, -1)
        if n_nodes <= 0 and rc == 0:
            continue
        if n_nodes <= 0 and rc < 0:
            # No evidence of usage in this pack — do not escalate
            continue
        hits.append(
            {
                "key": key,
                "path": file_ref,
                "reason": "entry_ish_tag",
                "tagged_nodes": n_nodes,
                "repo_count": rc,
            }
        )

    # Catalog keys with positive repo_count only (no dumped-object false matches)
    for ks, rc in list(key_counts.items())[:30]:
        if rc <= 0 or not ENTRY_TAG.search(ks):
            continue
        if any(h.get("key") == ks for h in hits):
            continue
        hits.append({"key": ks, "path": "", "reason": "entry_ish_tag_key", "repo_count": rc})
    return hits[:40]


def _path_intersects(hit_path: str, changed_paths: list[str]) -> bool:
    if not changed_paths:
        return False
    hp = hit_path.lower()
    for cp in changed_paths:
        c = cp.lower()
        if not c:
            continue
        if hp == c or hp.endswith(c) or c.endswith(hp) or c in hp or hp in c:
            return True
    return False


def _sensitive_snippet_is_usage(text: str) -> bool:
    """True when a non-doc / non-pattern line matches sensitive keywords.

    BM25 snippets often start at file headers; matching ``auth`` inside a module
    docstring previously forced T0 for scanner/helper sources on every edit.
    """
    if not text:
        return False
    in_doc = False
    for line in text.splitlines():
        s = line.strip()
        if not s:
            continue
        # Toggle on odd counts of triple quotes on the line (best-effort)
        if '"""' in s or "'''" in s:
            if s.count('"""') % 2 == 1 or s.count("'''") % 2 == 1:
                in_doc = not in_doc
            # Pure docstring delimiters / one-line docs → skip
            if s.startswith('"""') or s.startswith("'''") or in_doc:
                continue
        if in_doc:
            continue
        if s.startswith("#") and not s.startswith("#include"):
            continue
        if is_heuristic_meta_line(s):
            continue
        if SENSITIVE_HINT.search(s):
            return True
    return False


# Catalog and prose hits ("token" in a palette CSV, "auth" in llms.txt) are
# not an auth or payment implementation. They must not force T0.
_NON_CODE_EXT = re.compile(r"(?i)\.(csv|md|markdown|txt|rst|adoc|json|yml|yaml|svg|png|gif|webp|lock)$")


def _non_code_path(path: str) -> bool:
    return bool(_NON_CODE_EXT.search((path or "").replace("\\", "/")))


def sensitive_hits(sens_obj, changed_paths: list[str]) -> list[dict]:
    """Plan: 06-sensitive ∩ changed paths (auth/token/pay/secret) → T0.

    Skip search snippets that are clearly regex / keyword-list definitions or
    docstring prose so scanner/helper source does not force T0 on every edit.
    """
    hits = []
    if not sens_obj or not changed_paths:
        return hits
    blob = json.dumps(sens_obj, ensure_ascii=False)
    if not SENSITIVE_HINT.search(blob):
        return hits
    search = sens_obj.get("search") if isinstance(sens_obj, dict) else None
    results = []
    if isinstance(search, dict):
        results = search.get("results") or []
    elif isinstance(sens_obj, dict):
        results = sens_obj.get("results") or []
    for r in (results or [])[:40]:
        if not isinstance(r, dict):
            continue
        p = str(r.get("path") or r.get("file") or "")
        text = str(r.get("text") or r.get("snippet") or r.get("content") or "")
        if not _path_intersects(p, changed_paths) or _non_code_path(p):
            continue
        # Path basename alone (e.g. …/auth/…) still counts via classify_path;
        # search text must look like real usage, not pattern/docs meta.
        if text:
            if _sensitive_snippet_is_usage(text):
                hits.append({"path": p, "reason": "sensitive_search_hit"})
        elif SENSITIVE_HINT.search(p):
            hits.append({"path": p, "reason": "sensitive_search_hit"})
    if isinstance(sens_obj, dict):
        for q in sens_obj.get("symbol_name_queries") or []:
            if not isinstance(q, dict):
                continue
            name = str(q.get("name") or "")
            qpath = str(q.get("path") or q.get("file") or "")
            # Require path intersection; bare name queries alone do not force T0
            if (
                SENSITIVE_HINT.search(name)
                and qpath
                and not _non_code_path(qpath)
                and _path_intersects(qpath, changed_paths)
            ):
                hits.append({"path": qpath or name, "reason": "sensitive_symbol_query"})
        for cp in changed_paths:
            if _non_code_path(cp):
                continue
            if SENSITIVE_HINT.search(cp):
                hits.append({"path": cp, "reason": "sensitive_changed_path"})
    return hits[:40]


def main() -> None:
    if len(sys.argv) < 6:
        print(
            "usage: _risk_tier_body.py <pack_dir> <repo> <files_json> <lang_json> <out_json>",
            file=sys.stderr,
        )
        sys.exit(2)
    pack_dir, _repo, files_path, _lang_path, out_path = sys.argv[1:6]

    files_obj = load_json(files_path)
    tags_obj = load_json(os.path.join(pack_dir, "07-tags.json"))
    sens_obj = load_json(os.path.join(pack_dir, "06-sensitive-hits.json"))
    roll_obj = load_json(os.path.join(pack_dir, "15-rollout-signals.json"))

    paths = extract_paths(files_obj)
    missing_inputs = []
    if not paths:
        missing_inputs.append("04-changed-files")
    if tags_obj is None:
        missing_inputs.append("07-tags")
    if sens_obj is None:
        missing_inputs.append("06-sensitive-hits")
    if roll_obj is None:
        missing_inputs.append("15-rollout-signals")

    surfaces = {}
    if isinstance(roll_obj, dict):
        surfaces = roll_obj.get("surfaces") or {}
        if not isinstance(surfaces, dict):
            surfaces = {}

    path_hits = []
    file_tiers = []
    pack_tier = "T3"
    if not paths:
        pack_tier = "T1"  # uncertainty → escalate from T3
        file_tiers.append({"path": "", "tier": "T1", "reasons": ["no_paths_escalate"]})
    else:
        for rel in paths:
            tier, family, reasons = classify_path(rel)
            path_hits.append({"path": rel, "family": family, "tier": tier})
            file_tiers.append({"path": rel, "tier": tier, "reasons": reasons})
            pack_tier = better(pack_tier, tier)

    th = tag_hits(tags_obj, pack_dir)
    sh = sensitive_hits(sens_obj, paths)

    # Sensitive intersection → T0
    if sh:
        pack_tier = better(pack_tier, "T0")
        for h in sh[:5]:
            file_tiers.append(
                {
                    "path": h.get("path") or "",
                    "tier": "T0",
                    "reasons": [h.get("reason") or "sensitive"],
                }
            )

    # Rollout surfaces
    mig = bool(surfaces.get("migration"))
    destructive = bool(surfaces.get("destructive"))
    money = bool(surfaces.get("money"))
    breaking = bool(surfaces.get("breaking"))
    storage_switch = bool(surfaces.get("storage_switch"))
    feature_flag = bool(surfaces.get("feature_flag"))

    if mig or destructive:
        pack_tier = better(pack_tier, "T0")
        file_tiers.append(
            {
                "path": "",
                "tier": "T0",
                "reasons": ["rollout_migration" if mig else "rollout_destructive"],
            }
        )
    if money and (mig or destructive):
        pack_tier = better(pack_tier, "T0")
        file_tiers.append({"path": "", "tier": "T0", "reasons": ["rollout_money_cutover"]})
    elif money and pack_tier not in ("T0",):
        # money surface alone → at least T1 (pay adjacency); path pay already T0
        pack_tier = better(pack_tier, "T1")
        file_tiers.append({"path": "", "tier": "T1", "reasons": ["rollout_money_surface"]})

    if (breaking or storage_switch) and not feature_flag:
        pack_tier = better(pack_tier, "T1")
        file_tiers.append(
            {"path": "", "tier": "T1", "reasons": ["breaking_or_storage_without_flag"]}
        )

    # Entry tags bump T3/T2 toward T1 (not past T0)
    if th and pack_tier in ("T2", "T3"):
        pack_tier = better(pack_tier, "T1")
        file_tiers.append({"path": "", "tier": "T1", "reasons": ["entry_ish_tags"]})

    # Feature-flagged isolated change without T0 surfaces → T2 (plan); do not raise above T1
    if feature_flag and pack_tier not in ("T0", "T1"):
        # Keep/assign T2 for isolated flagged prod (already default for prod)
        if pack_tier == "T3":
            pack_tier = "T2"
            file_tiers.append({"path": "", "tier": "T2", "reasons": ["feature_flag_isolated"]})
        else:
            file_tiers.append({"path": "", "tier": "T2", "reasons": ["feature_flag_present"]})

    # Missing inputs: escalate one tier (never down)
    notes = []
    if missing_inputs:
        before = pack_tier
        pack_tier = escalate(pack_tier)
        notes.append(
            f"missing_inputs={','.join(missing_inputs)} — escalated {before}→{pack_tier}"
        )

    # All-test-docs only stays T3 only if no escalate and no T0 drivers
    only_test_docs = bool(paths) and all(
        h.get("family") == "test_docs" for h in path_hits
    )
    signals_thin = only_test_docs and pack_tier == "T3"

    depth = review_depth_for(pack_tier)
    payload = {
        "body_ok": True,
        "signals_thin": signals_thin,
        "tier": pack_tier,
        "tier_numeric": TIER_RANK[pack_tier],
        "industry_tier": INDUSTRY[pack_tier],
        "drivers": {
            "path_hits": path_hits[:80],
            "tag_hits": th,
            "sensitive_hits": sh,
            "rollout_surfaces": {
                "migration": mig,
                "destructive": destructive,
                "storage_switch": storage_switch,
                "breaking": breaking,
                "feature_flag": feature_flag,
                "money": money,
            },
        },
        "file_tiers": file_tiers[:100],
        "review_depth": depth,
        "files_considered": len(paths),
        "missing_inputs": missing_inputs,
        "notes": notes,
    }
    Path(out_path).write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
