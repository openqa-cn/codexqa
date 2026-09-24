#!/usr/bin/env python3
"""Route business rules before the model reads a method.

PR review judges the three-dot patch, not files that differ only because the
branch is behind the base. A rule whose own vocabulary is absent from the
span is a recorded skip. If the span cannot be read, every rule stays
applicable. Identical bodies are not collapsed: each symbol keeps its plan.
"""
from __future__ import annotations

import re

# Judged on every readable in-scope span. These can match ordinary code.
ALWAYS = (
    "LOGIC-001",
    "BND-001",
    "NULL-001",
    "RES-001",
    "HYG-001",
    "DES-001",
)

# Fail closed only when the span has none of the rule's own nouns.
# A span that cannot be read does not use this table.
FAMILIES = (
    (
        "money",
        re.compile(
            r"(?i)\b(debit|credit|refund|capture|settle|payment|payout|amount|"
            r"ledger|balance|invoice|withdraw|transfer)\b"
        ),
        (
            "BIZ-001",
            "BIZ-002",
            "BIZ-003",
            "BIZ-004",
            "BIZ-005",
            "TXN-001",
            "PAY-001",
            "PAY-002",
            "PAY-004",
            "PAY-005",
            "PAY-006",
            "PAY-007",
        ),
        "span has no debit, credit, payment, amount, or ledger write",
    ),
    (
        "concurrency",
        re.compile(
            r"(?i)\b(lock|mutex|synchronized|thread|atomic|concurrent|"
            r"reentrant)\b"
        ),
        ("CONC-001", "CONC-002", "CONC-003"),
        "span has no lock, thread, or atomic update",
    ),
    (
        "auth",
        re.compile(
            r"(?i)\b(auth|token|password|session|permission|role|"
            r"unauthorized|signin|login)\b"
        ),
        ("SEC-001", "AUTH-001", "AUTH-002"),
        "span has no auth, token, session, or role check",
    ),
    (
        "tenant",
        re.compile(r"(?i)\btenants?\b"),
        ("TEN-002", "TEN-004", "TEN-005", "TEN-006"),
        "span has no tenant id or tenant scope",
    ),
    (
        "api",
        re.compile(r"(?i)(@deprecated|\bexport\b|\bpublic\b)"),
        ("API-001",),
        "span has no exported or public signature",
    ),
    (
        "structure",
        re.compile(r"(?i)\b(static|global)\b"),
        ("ARCH-001", "GLOB-001"),
        "span has no static or global mutable",
    ),
)


def rule_plan(text: str | None, kind: str) -> dict:
    """Return applicable rule ids and recorded skips.

    ``text is None`` means the span could not be read: do not skip.
    ``file_scope`` is not a method; structure rules stay applicable there
    because the uncovered lines are the fields around the methods.
    """
    applicable = list(ALWAYS)
    skips = []
    if kind == "file_scope":
        applicable.extend(("ARCH-001", "GLOB-001"))
    if text is None:
        for _name, _rx, rules, _note in FAMILIES:
            for rule_id in rules:
                if rule_id not in applicable:
                    applicable.append(rule_id)
        return {"applicable": applicable, "skips": skips, "span_read": False}
    for _name, rx, rules, note in FAMILIES:
        if kind == "file_scope" and _name == "structure":
            continue
        if rx.search(text):
            applicable.extend(rules)
        else:
            for rule_id in rules:
                skips.append({"rule_id": rule_id, "note": note})
    return {"applicable": applicable, "skips": skips, "span_read": True}
