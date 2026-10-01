"""
Threshold calibration.

The Supervisor's Accept/Negotiate/Reject bands (70 / 45) were set against an
earlier model. After pinning Groq, every observed live run landed in the 60s
and nothing reached Accept — so the bands need checking against an actual
score distribution rather than being nudged until a favourite deal passes.

Method: build a labelled set of deals whose correct verdict is not in serious
dispute (a fair offer to a well-matched creator should Accept; four times the
creator's own rate should not), run them through the real engine, and look at
where the scores actually fall. The labels are stated up front in DEALS so the
reasoning is auditable rather than fitted after the fact.

    python tools/calibrate_thresholds.py          # run and save
    python tools/calibrate_thresholds.py --report # re-analyse the saved run

Costs 5 Groq calls per deal. Groq's ceiling is tokens-per-minute, so the run
paces itself; app/llm.py retries on 429 regardless.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.config import get_connection  # noqa: E402
from app.display import asciify, init_stdout  # noqa: E402
from app.graph import build_graph  # noqa: E402
from app.supervisor import ACCEPT_AT, NEGOTIATE_AT  # noqa: E402

init_stdout()

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "calibration.json")
RULE = "=" * 78

# Each case names a creator by niche/platform shape, an offer expressed as a
# multiple of that creator's OWN listed price, and the verdict a human would
# defend. Expressing the offer relatively keeps the labels honest across
# creators of very different sizes.
DEALS = [
    # --- should clearly Accept: well matched, priced at or under their rate ---
    dict(id="A1", niche="gaming", platform="youtube", mult=0.85, brand="GameFuel Energy",
         brand_niche="gaming", expect="Accept", why="on-niche, offer below their own rate"),
    dict(id="A2", niche="gaming", platform="youtube", mult=1.00, brand="GameFuel Energy",
         brand_niche="gaming", expect="Accept", why="on-niche, offer exactly their rate"),
    dict(id="A3", niche="Fashion", platform="instagram", mult=1.00, brand="Lumen Beauty",
         brand_niche="Fashion", expect="Accept", why="on-niche, offer at their rate"),
    dict(id="A4", niche="finance", platform="youtube", mult=1.10, brand="Paisa Simple",
         brand_niche="finance", expect="Accept", why="on-niche, small premium"),

    # --- should Negotiate: defensible but needs a conversation ---
    dict(id="N1", niche="gaming", platform="youtube", mult=1.60, brand="GameFuel Energy",
         brand_niche="gaming", expect="Negotiate", why="on-niche but 60% over their rate"),
    dict(id="N2", niche="Fashion", platform="instagram", mult=1.80, brand="Lumen Beauty",
         brand_niche="Fashion", expect="Negotiate", why="on-niche but well over rate"),
    dict(id="N3", niche="vlog", platform="youtube", mult=1.00, brand="GameFuel Energy",
         brand_niche="gaming", expect="Negotiate", why="fair price, adjacent niche"),
    dict(id="N4", niche="entertainment", platform="instagram", mult=1.20, brand="Lumen Beauty",
         brand_niche="Fashion", expect="Negotiate", why="slight premium, adjacent niche"),

    # --- should Reject: badly overpriced or badly matched ---
    dict(id="R1", niche="gaming", platform="youtube", mult=4.00, brand="GameFuel Energy",
         brand_niche="gaming", expect="Reject", why="four times their own rate"),
    dict(id="R2", niche="Fashion", platform="instagram", mult=5.00, brand="Lumen Beauty",
         brand_niche="Fashion", expect="Reject", why="five times their own rate"),
    dict(id="R3", niche="finance", platform="youtube", mult=3.50, brand="Lumen Beauty",
         brand_niche="Fashion", expect="Reject", why="wrong niche AND badly overpriced"),
    dict(id="R4", niche="food", platform="instagram", mult=3.00, brand="GameFuel Energy",
         brand_niche="gaming", expect="Reject", why="wrong niche, 3x rate"),
]

ORDER = {"Accept": 2, "Negotiate": 1, "Reject": 0}


def pick_creator(conn, niche, platform):
    """
    A representative, well-documented creator of that shape.

    Deliberately requires a quoted (not KNN-estimated) price and full data
    confidence: calibrating the bands against rows with missing inputs would
    measure the data gaps rather than the scoring.
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT creator_id, name, platform, niche, followers_count, engagement_rate,
                   price_inr, price_estimated, data_confidence_score
            FROM creators
            WHERE platform = %s AND niche ILIKE %s
              AND price_inr IS NOT NULL AND price_estimated = false
              -- > 0, not IS NOT NULL: zero means "not measured" in this roster,
              -- so a zero row would calibrate the bands against a data gap.
              AND engagement_rate > 0 AND data_confidence_score >= 75
              AND followers_count >= 50000
            ORDER BY followers_count DESC
            LIMIT 1
            """,
            (platform, f"%{niche}%"),
        )
        row = cur.fetchone()
    if not row:
        return None
    keys = ["creator_id", "creator_name", "platform", "niche", "followers_count",
            "engagement_rate", "price_inr", "price_estimated", "data_confidence_score"]
    return dict(zip(keys, row))


def run_all():
    conn = get_connection()
    try:
        cases = []
        for d in DEALS:
            creator = pick_creator(conn, d["niche"], d["platform"])
            if not creator:
                print(f"  SKIP {d['id']}: no creator matching {d['platform']}/{d['niche']}")
                continue
            cases.append((d, creator))
    finally:
        conn.close()

    graph = build_graph()
    results = []
    print(f"{RULE}\n  Running {len(cases)} labelled deals through the real engine\n{RULE}")

    for i, (d, creator) in enumerate(cases, 1):
        offer = int(round(creator["price_inr"] * d["mult"]))
        state = {
            **creator,
            "brand_name": d["brand"],
            # Anchor the budget to the creator's MARKET RATE, not to the offer.
            # Deriving it from the offer told the agents the offer was in budget
            # by construction, which is why a 4x overpay scored 70 on pricing:
            # the model was answering "does this fit the budget?" when the
            # question is "is this a sensible price for this creator?".
            "brand_budget_min": int(creator["price_inr"] * 0.8),
            "brand_budget_max": int(creator["price_inr"] * 1.3),
            "brand_target_niche": d["brand_niche"],
            "brand_platform_preference": creator["platform"],
            "proposed_amount": offer,
            "deliverable": "1 integration video",
            "contract_text": None,
        }
        t0 = time.perf_counter()
        out = graph.invoke(state)
        took = time.perf_counter() - t0
        v = out["verdict"]
        agents = {k: (r or {}).get("score") for k, r in v["agent_breakdown"].items()}

        row = dict(
            id=d["id"], expect=d["expect"], why=d["why"],
            creator=creator["creator_name"], platform=creator["platform"],
            niche=creator["niche"], followers=creator["followers_count"],
            rate=creator["price_inr"], mult=d["mult"], offer=offer,
            score=v["weighted_score"], verdict=v["verdict"],
            hard_rule=v["hard_rule_applied"], agents=agents, seconds=round(took, 1),
        )
        results.append(row)
        print(f"  [{i:>2}/{len(cases)}] {d['id']:<3} {asciify(creator['creator_name'])[:20]:<22}"
              f"x{d['mult']:<5} score {v['weighted_score']:>5}  got {v['verdict']:<10}"
              f"want {d['expect']:<10} {took:>5.1f}s")

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2)
    print(f"\n  saved -> {OUT}")
    return results


def classify(score, accept_at, negotiate_at):
    if score >= accept_at:
        return "Accept"
    if score >= negotiate_at:
        return "Negotiate"
    return "Reject"


def report(results):
    print(f"\n{RULE}\n  SCORE DISTRIBUTION BY INTENDED VERDICT\n{RULE}")
    by_label = {}
    for r in results:
        by_label.setdefault(r["expect"], []).append(r["score"])
    for label in ("Accept", "Negotiate", "Reject"):
        xs = sorted(by_label.get(label, []))
        if not xs:
            continue
        print(f"  {label:<10} n={len(xs):<3} min {min(xs):>5}  median {statistics.median(xs):>6}  "
              f"max {max(xs):>5}   {xs}")

    print(f"\n{RULE}\n  PER-AGENT MEANS (what is actually moving the score)\n{RULE}")
    names = sorted({k for r in results for k in r["agents"]})
    print(f"  {'agent':<16}" + "".join(f"{lbl:>12}" for lbl in ("Accept", "Negotiate", "Reject")))
    for n in names:
        cells = ""
        for lbl in ("Accept", "Negotiate", "Reject"):
            vals = [r["agents"][n] for r in results
                    if r["expect"] == lbl and isinstance(r["agents"].get(n), (int, float))]
            cells += f"{statistics.mean(vals):>12.1f}" if vals else f"{'-':>12}"
        print(f"  {n:<16}{cells}")

    print(f"\n{RULE}\n  BAND SEARCH - which thresholds best reproduce the labels\n{RULE}")
    best = []
    for accept_at in range(50, 86):
        for negotiate_at in range(25, accept_at):
            correct = sum(1 for r in results
                          if classify(r["score"], accept_at, negotiate_at) == r["expect"])
            # Penalise calling a bad deal good more than the reverse.
            severe = sum(1 for r in results
                         if ORDER[classify(r["score"], accept_at, negotiate_at)] - ORDER[r["expect"]] >= 2)
            best.append((correct, -severe, accept_at, negotiate_at))
    best.sort(reverse=True)
    top = best[0]
    live = sum(1 for r in results
               if classify(r["score"], ACCEPT_AT, NEGOTIATE_AT) == r["expect"])
    print(f"  live     {ACCEPT_AT} / {NEGOTIATE_AT} -> {live}/{len(results)} correct")
    print(f"  best     {top[2]} / {top[3]} -> {top[0]}/{len(results)} correct, "
          f"{-top[1]} severe misclassifications")
    print("\n  top candidates:")
    seen = set()
    for correct, neg_severe, a, n in best[:40]:
        if (correct, neg_severe) in seen:
            continue
        seen.add((correct, neg_severe))
        print(f"    {a:>3} / {n:<3}  {correct}/{len(results)} correct, {-neg_severe} severe")
        if len(seen) >= 5:
            break


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true",
                    help="re-analyse the saved run instead of calling the engine again")
    args = ap.parse_args()

    if args.report:
        with open(OUT, encoding="utf-8") as fh:
            report(json.load(fh))
    else:
        report(run_all())
