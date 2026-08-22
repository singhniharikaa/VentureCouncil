"""
VentureCouncil - live demo of the 5-agent evaluation pipeline.

Unlike main.py (which just prints a final verdict), this streams the graph
superstep by superstep, so you can SEE the fan-out: the four independent
agents land together in one step, Negotiation waits for Pricing, and the
Supervisor waits for everything.

Usage:
    python demo.py                          # default: Bulky, Rs.35,000
    python demo.py "Chirag Sajnani" 6000
    python demo.py "Bulky" 35000 --brand "GameFuel Energy" --niche gaming

Output is deliberately ASCII-only so it renders correctly in cmd/PowerShell.
"""
import argparse
import io
import json
import os
import random
import sys
import time

from app.display import asciify, init_stdout

init_stdout()

BAR_W = 34
RULE = "=" * 78
THIN = "-" * 78

# which state key each node writes, for pretty-printing as it streams
NODE_OUTPUT_KEY = {
    "audience_fit": "audience_fit_result",
    "engagement": "engagement_result",
    "pricing": "pricing_result",
    "risk": "risk_result",
    "negotiation": "negotiation_result",
}

NODE_BLURB = {
    "audience_fit": "niche / platform / follower-tier match vs the brand",
    "engagement": "SQL percentile vs same-platform peers",
    "pricing": "pgvector search over past_deals for comparables",
    "risk": "data confidence, price-per-follower, contract flags",
    "negotiation": "reads Pricing's verdict, proposes a counter-offer",
}


def bar(score, width=BAR_W):
    """Render a 0-100 score as an ASCII meter."""
    try:
        score = float(score)
    except (TypeError, ValueError):
        return "?" * 10
    filled = int(round(max(0.0, min(100.0, score)) / 100 * width))
    return "[" + "#" * filled + "." * (width - filled) + "]"


def wrap(text, width=72, indent="      "):
    words = asciify(text).split()
    lines, cur = [], ""
    for w in words:
        if len(cur) + len(w) + 1 > width:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}".strip()
    if cur:
        lines.append(cur)
    return "\n".join(indent + ln for ln in lines)


def load_creator_by_name(conn, name):
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT creator_id, name, platform, niche, followers_count,
                   engagement_rate, price_inr, price_estimated, data_confidence_score
            FROM creators WHERE name = %s LIMIT 1
            """,
            (name,),
        )
        row = cur.fetchone()
    if not row:
        raise SystemExit(f"No creator found with name '{name}'")
    keys = [
        "creator_id", "creator_name", "platform", "niche", "followers_count",
        "engagement_rate", "price_inr", "price_estimated", "data_confidence_score",
    ]
    return dict(zip(keys, row))


def fmt(value, kind=""):
    if value is None:
        return "NULL (missing)"
    if kind == "money":
        return f"Rs.{value:,.0f}"
    if kind == "count":
        return f"{value:,}"
    if kind == "pct":
        return f"{value:.2f}%"
    return str(value)


def stream_offline(args):
    """Replay a recorded real run. No network, no API quota, no DB."""
    with io.open("demo_fixtures.json", encoding="utf-8") as fh:
        fixtures = json.load(fh)
    key = f"{args.creator}|{args.amount}"
    if key not in fixtures:
        avail = ", ".join(k for k in fixtures if not k.startswith("_"))
        raise SystemExit(
            "No recorded run for '%s'. Available: %s" % (key, avail))
    fx = fixtures[key]
    for group in (["audience_fit", "engagement", "pricing", "risk"], ["negotiation"]):
        time.sleep(random.uniform(0.6, 1.1))
        yield {n: {NODE_OUTPUT_KEY[n]: fx[NODE_OUTPUT_KEY[n]]} for n in group}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("creator", nargs="?", default="Bulky")
    ap.add_argument("amount", nargs="?", type=int, default=35000)
    ap.add_argument("--brand", default="GameFuel Energy")
    ap.add_argument("--niche", default="gaming")
    ap.add_argument("--budget-min", type=int, default=25000)
    ap.add_argument("--budget-max", type=int, default=40000)
    ap.add_argument("--deliverable", default="1 integration video")
    ap.add_argument("--provider", default=None, choices=["gemini", "grok"],
                    help="which LLM provider to use (default: LLM_PROVIDER "
                         "from .env, or gemini).")
    ap.add_argument("--model", default=None,
                    help="override the model, e.g. gemini-3.1-flash-lite or "
                         "grok-4.3. On Gemini free tier the quota is per-model, "
                         "so a different model gives a fresh daily allowance.")
    ap.add_argument("--concurrency", type=int, default=None,
                    help="max simultaneous LLM calls (default 4). Drop to 2 on "
                         "Gemini free tier to stay under its 5 requests/minute.")
    ap.add_argument("--record", action="store_true",
                    help="run live, then save the result into demo_fixtures.json "
                         "so it can be replayed later with --offline.")
    ap.add_argument("--offline", action="store_true",
                    help="replay a recorded real run - no API calls, no quota, "
                         "no network. Use this when demoing.")
    args = ap.parse_args()

    if args.provider:
        os.environ["LLM_PROVIDER"] = args.provider
    if args.concurrency:
        os.environ["LLM_MAX_CONCURRENCY"] = str(args.concurrency)
    if args.model:
        key = "GROK_MODEL" if os.environ.get("LLM_PROVIDER") == "grok" else "GEMINI_MODEL"
        os.environ[key] = args.model

    if args.offline:
        with io.open("demo_fixtures.json", encoding="utf-8") as fh:
            fx = json.load(fh)
        key = f"{args.creator}|{args.amount}"
        if key not in fx:
            raise SystemExit(
                "No recorded run for '%s'. Available: %s"
                % (key, ", ".join(k for k in fx if not k.startswith("_"))))
        creator = fx[key]["creator"]
    else:
        from app.config import get_connection
        conn = get_connection()
        try:
            creator = load_creator_by_name(conn, args.creator)
        finally:
            conn.close()

    print()
    print(RULE)
    print("  VentureCouncil - multi-agent creator-brand deal evaluation")
    if args.offline:
        print("  *** OFFLINE REPLAY of a recorded real run (no API calls) ***")
    else:
        from app.llm import model_name, provider
        print(f"  LIVE - provider: {provider()}  model: {model_name()}")
    print(RULE)
    print()
    print("  CREATOR (from Supabase)")
    print(f"    name .............. {creator['creator_name']}"
          + (f"  (id {creator['creator_id']})" if creator.get('creator_id') else ""))
    print(f"    platform .......... {creator['platform']}")
    print(f"    niche ............. {fmt(creator['niche'])}")
    print(f"    followers ......... {fmt(creator['followers_count'], 'count')}")
    print(f"    engagement rate ... {fmt(creator['engagement_rate'], 'pct')}")
    print(f"    listed price ...... {fmt(creator['price_inr'], 'money')}"
          f"  ({'ESTIMATED' if creator['price_estimated'] else 'real data'})")
    print(f"    data confidence ... {creator['data_confidence_score']}/100")
    print()
    print("  BRAND / DEAL (the offer on the table)")
    print(f"    brand ............. {args.brand}")
    print(f"    target niche ...... {args.niche}")
    print(f"    budget range ...... Rs.{args.budget_min:,} - Rs.{args.budget_max:,}")
    print(f"    deliverable ....... {args.deliverable}")
    print(f"    proposed amount ... Rs.{args.amount:,}")
    print()

    state = {
        **creator,
        "brand_name": args.brand,
        "brand_budget_min": args.budget_min,
        "brand_budget_max": args.budget_max,
        "brand_target_niche": args.niche,
        "brand_platform_preference": creator["platform"],
        "proposed_amount": args.amount,
        "deliverable": args.deliverable,
        "contract_text": None,
    }

    print(RULE)
    print("  AGENTS RUNNING")
    print(RULE)
    print()
    print("  Graph shape: audience_fit | engagement | pricing | risk  all start")
    print("  together. negotiation waits for pricing. supervisor waits for all.")
    print("  Each block prints the moment that agent finishes. Watch the t+ times:")
    print("  the first four overlap (they run concurrently), while negotiation")
    print("  cannot start until pricing has returned.")
    print()

    if args.offline:
        stream = stream_offline(args)
    else:
        from app.graph import build_graph
        stream = build_graph().stream(state, stream_mode="updates")

    started = time.time()
    step = 0
    final_state = dict(state)

    for update in stream:
        step += 1
        elapsed = time.time() - started
        nodes = [n for n in update if n in NODE_OUTPUT_KEY]
        if nodes:
            label = " + ".join(nodes)
            parallel = "  (finished together)" if len(nodes) > 1 else ""
            print(THIN)
            print(f"  STEP {step}  [t+{elapsed:5.1f}s]  {label}{parallel}")
            print(THIN)
        for node, payload in update.items():
            final_state.update(payload)
            key = NODE_OUTPUT_KEY.get(node)
            if not key:
                continue
            r = payload.get(key, {})
            score = r.get("score", "?")
            print()
            print(f"  >> {node.upper()}")
            print(f"     what it does: {NODE_BLURB.get(node, '')}")
            print(f"     score {str(score):>4} / 100  {bar(score)}")
            print(f"     verdict ...... {asciify(r.get('verdict_component', 'N/A'))}")
            print(f"     confidence ... {r.get('confidence', 'N/A')}")
            print("     reasoning:")
            print(wrap(r.get("reasoning", "no reasoning returned")))
            print()

    if args.offline:
        from app.supervisor import run as supervisor_run
        final_state.update(supervisor_run(final_state))
    verdict = final_state["verdict"]
    total = time.time() - started

    print(RULE)
    print("  SUPERVISOR - weighted consolidation")
    print(RULE)
    print()
    print("    agent            score   weight   contribution")
    print("    " + "-" * 48)
    from app.supervisor import WEIGHTS
    running = 0.0
    for key, weight in WEIGHTS.items():
        name = key.replace("_result", "")
        sc = final_state.get(key, {}).get("score", 50)
        contrib = sc * weight
        running += contrib
        print(f"    {name:<16} {sc:>5}   {weight:>5.2f}   {contrib:>10.1f}")
    print("    " + "-" * 48)
    print(f"    {'WEIGHTED TOTAL':<16} {'':>5}   {'':>5}   {running:>10.1f}")
    print()
    risk_level = final_state.get("risk_result", {}).get("verdict_component", "n/a")
    print(f"    risk agent is NOT weighted - it acts as a veto instead.")
    print(f"    risk level: {risk_level}")
    print(f"    hard rule (high risk can never Accept) applied: "
          f"{verdict['hard_rule_applied']}")
    print()
    print("    thresholds:  >= 70 Accept   |   >= 45 Negotiate   |   < 45 Reject")
    print()
    if args.record and not args.offline:
        from app.llm import model_name as _mn, provider as _pv
        path = "demo_fixtures.json"
        try:
            with io.open(path, encoding="utf-8") as fh:
                fixtures = json.load(fh)
        except FileNotFoundError:
            fixtures = {}
        entry = {"creator": {k: creator[k] for k in creator},
                 "recorded_provider": _pv(), "recorded_model": _mn(),
                 "recorded_at": time.strftime("%Y-%m-%d %H:%M:%S")}
        for node, out_key in NODE_OUTPUT_KEY.items():
            entry[out_key] = final_state.get(out_key, {})
        fixtures[f"{args.creator}|{args.amount}"] = entry
        fixtures["_note"] = (
            "Recorded from real live runs by demo.py --record. Used by "
            "demo.py --offline so a demo never depends on API quota or network.")
        with io.open(path, "w", encoding="utf-8", newline=chr(10)) as fh:
            json.dump(fixtures, fh, indent=2, default=str)
        print(f"  [recorded to {path} as '{args.creator}|{args.amount}']")
        print()

    print(RULE)
    print(f"  FINAL VERDICT: {verdict['verdict'].upper()}"
          f"   (score {verdict['weighted_score']})")
    print(f"  evaluated in {total:.1f}s across 5 agents")
    print(RULE)
    print()


if __name__ == "__main__":
    sys.exit(main())
