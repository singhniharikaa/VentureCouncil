"""
Contract red-flag scan - fixed rules, not AI.

Why this exists: the Supervisor's veto ("high risk can never be Accepted") only
fires when the Risk agent LABELS a deal "high risk". That label came from the
language model alone, and it is not reliable on contracts. Tested live: a fair
deal wrapped in perpetual unlimited usage rights, 24 months of uncompensated
exclusivity, Net-90 payment and no kill fee was rated only "medium risk" (score
40), so the veto never fired and the deal was ACCEPTED.

A rule that protects the brand should not depend on the model choosing a word.
So the clauses that are unacceptable on their own are matched here by pattern,
and when one is found the Risk result is forced to "high risk" - which the
Supervisor's existing rule then turns into "never Accept". The model still
writes the explanation and still judges everything else; it just can no longer
talk its way past a clause like "perpetual, unlimited usage".

Only CRITICAL clauses force the label. Softer ones (long payment terms, no kill
fee, ...) are reported as flags and left to the model's judgement, because a
rule that fires on every ordinary contract would be noise.
"""
from __future__ import annotations

import re
from typing import Optional

# A little tolerance either side of a keyword, without crossing into the next
# clause. `.` does not match newlines, so a pattern stays inside one sentence.
_GAP = r"[^.\n]{0,160}"

# (label, regex, critical)
PATTERNS = [
    ("Perpetual / unlimited usage rights",
     r"perpetual|in perpetuity|unlimited usage|usage rights?[^.\n]{0,40}unlimited", True),
    ("Assignment of creator IP",
     r"assign(?:ment)? of (?:the )?(?:account|ip|intellectual property)|"
     r"transfer[^.\n]{0,40}ownership of (?:the )?(?:account|content|channel)", True),
    ("Exclusivity with no stated compensation",
     r"exclusiv" + _GAP + r"(?:no (?:additional |extra )?compensation|"
     r"without (?:additional |extra )?compensation|uncompensated|unpaid|at no (?:extra )?cost)", True),

    ("Exclusivity clause present", r"exclusiv", False),
    ("No kill fee on cancellation",
     r"no kill fee|without (?:a )?kill fee|no cancellation fee", False),
    ("Net-60 or longer payment terms", r"net[-\s]?(?:60|90|120)", False),
    ("Brand may withhold payment / unilateral approval",
     r"sole discretion|unilateral|withhold payment", False),
    ("No revision cap", r"unlimited revisions|no revision (?:cap|limit)", False),
]

_COMPILED = [(label, re.compile(rx, re.IGNORECASE), critical) for label, rx, critical in PATTERNS]

CRITICAL_SCORE_CAP = 30   # Risk scores run 100 = safe, 0 = severe


def scan_contract(text: Optional[str]) -> dict:
    """Return {"flags": [...], "critical": [...]} for the contract text."""
    if not text or not text.strip():
        return {"flags": [], "critical": []}

    flags: list[str] = []
    critical: list[str] = []
    for label, rx, is_critical in _COMPILED:
        if rx.search(text):
            flags.append(label)
            if is_critical:
                critical.append(label)

    # "Exclusivity clause present" is implied by the uncompensated version;
    # reporting both is redundant noise.
    if "Exclusivity with no stated compensation" in flags and "Exclusivity clause present" in flags:
        flags.remove("Exclusivity clause present")
    return {"flags": flags, "critical": critical}


def apply_contract_rules(result: dict, contract_text: Optional[str]) -> dict:
    """
    Layer the fixed contract rules over the Risk agent's own answer.

    Returns a NEW dict; the model's output is never mutated. With no contract
    text, or a contract with no critical clause, the model's answer stands (the
    soft flags are still attached for display).
    """
    scan = scan_contract(contract_text)
    out = dict(result)
    out["contract_flags"] = scan["flags"]

    if not scan["critical"]:
        return out

    found = "; ".join(scan["critical"])
    out["verdict_component"] = "high risk"
    out["score"] = min(result.get("score") or 0, CRITICAL_SCORE_CAP)
    out["contract_rule_applied"] = True
    out["reasoning"] = (
        f"{(result.get('reasoning') or '').strip()} "
        f"Contract scan (a fixed rule, not the AI) found: {found}. "
        f"These clauses are unacceptable on their own, so the deal is rated high risk."
    ).strip()
    return out
