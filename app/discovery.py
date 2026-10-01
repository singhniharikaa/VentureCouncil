"""
Path A — discovery.

A brand describes what it wants in free text ("energy drink launch aimed at
mobile gamers, under 50k"), and this returns ranked creator candidates. The
brand then picks N of them, and each selected creator goes through the same
five-agent evaluation as Path B.

Design: **hard filters + semantic ranking**, not similarity alone.

A creator who matches the brief perfectly but costs three times the budget is
not a match, and burning an LLM evaluation on them is wasted quota. So budget,
platform and reach are SQL `WHERE` clauses that remove candidates outright,
while the vector search only decides the ORDER of what survives. Filtering
after ranking would be worse: the top-k would fill with unaffordable creators
and the affordable ones would never surface.

Three gotchas from CLAUDE.md apply directly here and are all handled below:

  * #4 — the embedding must be bound as a STRING. psycopg2 adapts a Python
    list to ARRAY[...], which will not cast via %s::vector.
  * #5 — `creators` has an ivfflat index built with the default lists=100 over
    775 rows, so the default probes=1 silently returns far fewer and WORSE
    rows than asked for. Every vector query must raise probes first.
  * #6 — it must be SET LOCAL, inside the same transaction as the SELECT. The
    Supabase pooler is pgbouncer in transaction mode, so a session-level SET
    lands on a different backend and is silently lost.
"""
from __future__ import annotations

from typing import Any, Optional

from app.config import VECTOR_PROBES_SQL, embed_text

# Columns every discovery result carries. Note `whatsapp` is deliberately NOT
# selected — contact details play no part in matching, and this result set is
# served over the API.
SELECT_COLUMNS = """
    creator_id, name, platform, niche, followers_count, engagement_rate,
    price_inr, price_estimated, data_confidence_score, profile_url
"""

MAX_LIMIT = 100


# `creators.embedding` was NOT built from prose. Every row was embedded from a
# fixed five-slot template:
#
#   "{platform} creator, {niche} niche, {bucket} followers,
#    {engagement} engagement, price around {band}"
#
# A raw brand brief ("energy drink launch for mobile gamers") shares almost no
# vocabulary with that, which is why it scored ~0.27 and surfaced cricket
# creators. Rebuilding the query in the same template puts it in the same
# region of vector space. These bucket labels are read off the seeded data and
# must match it exactly — a near-miss spelling defeats the point.
FOLLOWER_BUCKETS = [
    (50_000, "under 50k"),
    (200_000, "50k-200k"),
    (500_000, "200k-500k"),
    (1_000_000, "500k-1m"),
    (None, "1m+"),
]

PRICE_BANDS = [
    (15_000, "under 15k"),
    (30_000, "15k-30k"),
    (50_000, "30k-50k"),
    (100_000, "50k-100k"),
    (None, "100k+"),
]


def _bucket(value: Optional[int], table) -> Optional[str]:
    if value is None:
        return None
    for ceiling, label in table:
        if ceiling is None or value <= ceiling:
            return label
    return table[-1][1]


def build_query_text(
    brief: str,
    *,
    niche: Optional[str] = None,
    platform: Optional[str] = None,
    budget_max: Optional[int] = None,
    min_followers: Optional[int] = None,
    max_followers: Optional[int] = None,
) -> str:
    """
    Rewrite the brand's request in the same shape the creator embeddings use,
    then append the free text.

    The structured half does the heavy lifting (it is what the vectors actually
    encode); the free text still contributes nuance the slots cannot express,
    such as "family-friendly" or "south India".
    """
    slots = []
    if platform:
        slots.append(f"{platform} creator")
    if niche:
        slots.append(f"{niche} niche")

    follower_hint = _bucket(max_followers, FOLLOWER_BUCKETS) or _bucket(
        min_followers, FOLLOWER_BUCKETS
    )
    if follower_hint:
        slots.append(f"{follower_hint} followers")

    band = _bucket(budget_max, PRICE_BANDS)
    if band:
        slots.append(f"price around {band}")

    template = ", ".join(slots)
    brief = (brief or "").strip()
    if template and brief:
        return f"{template}. {brief}"
    return template or brief


def discover_creators(
    conn,
    brief: str,
    *,
    platform: Optional[str] = None,
    niche: Optional[str] = None,
    budget_min: Optional[int] = None,
    budget_max: Optional[int] = None,
    min_followers: Optional[int] = None,
    max_followers: Optional[int] = None,
    real_price_only: bool = False,
    min_confidence: Optional[int] = None,
    limit: int = 20,
) -> list[dict[str, Any]]:
    """
    Rank creators against a free-text brief, after removing those that cannot
    work on hard constraints.

    Every filter is optional; passing none degrades to pure semantic search
    over the whole roster. `limit` is clamped so a caller cannot ask for the
    entire table.

    Returns dicts with the selected columns plus:
        similarity  0..1, cosine similarity to the brief
        distance    1 - similarity, for the UI
    """
    limit = max(1, min(int(limit), MAX_LIMIT))
    query_text = build_query_text(
        brief,
        niche=niche,
        platform=platform,
        budget_max=budget_max,
        min_followers=min_followers,
        max_followers=max_followers,
    )

    # Gotcha #4: bind the vector as its literal string form.
    embedding = str(embed_text(query_text))

    where = ["embedding IS NOT NULL"]
    params: list[Any] = []

    if platform:
        where.append("platform = %s")
        params.append(platform)

    if niche:
        # Matched loosely: the roster stores "gaming / FF" style sub-niches,
        # and a brand asking for "gaming" should still see those.
        where.append("niche ILIKE %s")
        params.append(f"%{niche}%")

    # Budget is the filter that matters most — it is what stops the council
    # from spending five LLM calls on a creator the brand cannot afford.
    if budget_max is not None:
        where.append("(price_inr IS NULL OR price_inr <= %s)")
        params.append(budget_max)
    if budget_min is not None:
        where.append("(price_inr IS NULL OR price_inr >= %s)")
        params.append(budget_min)

    if min_followers is not None:
        where.append("followers_count >= %s")
        params.append(min_followers)
    if max_followers is not None:
        where.append("followers_count <= %s")
        params.append(max_followers)

    if real_price_only:
        # Excludes KNN-estimated prices, so a budget filter means something.
        where.append("price_estimated = false")

    if min_confidence is not None:
        where.append("data_confidence_score >= %s")
        params.append(min_confidence)

    sql = f"""
        SELECT {SELECT_COLUMNS},
               1 - (embedding <=> %s::vector) AS similarity
        FROM creators
        WHERE {' AND '.join(where)}
        ORDER BY embedding <=> %s::vector,
                 -- The embedding encodes only five coarse buckets, so every
                 -- creator in the same bucket scores nearly identically and
                 -- ties are common. Left to the vector alone the order within
                 -- a tie is arbitrary, which put a 2-follower channel third.
                 -- Break ties on data quality, then reach.
                 data_confidence_score DESC NULLS LAST,
                 followers_count DESC NULLS LAST
        LIMIT %s
    """

    with conn.cursor() as cur:
        # Gotchas #5 and #6: raise ivfflat probes, with SET LOCAL, inside this
        # same transaction. Without it this returns ~8 arbitrary rows whatever
        # `limit` says.
        cur.execute(VECTOR_PROBES_SQL)
        cur.execute(sql, [embedding, *params, embedding, limit])
        columns = [d[0] for d in cur.description]
        rows = [dict(zip(columns, r)) for r in cur.fetchall()]

    for row in rows:
        sim = row.get("similarity")
        row["similarity"] = round(float(sim), 4) if sim is not None else None
        row["distance"] = round(1 - float(sim), 4) if sim is not None else None
    return rows


def summarise_filters(
    *,
    platform: Optional[str] = None,
    niche: Optional[str] = None,
    budget_min: Optional[int] = None,
    budget_max: Optional[int] = None,
    min_followers: Optional[int] = None,
    max_followers: Optional[int] = None,
    real_price_only: bool = False,
    min_confidence: Optional[int] = None,
) -> list[str]:
    """
    Human-readable list of the hard constraints applied, so the UI can show
    *why* the candidate pool is what it is rather than presenting a ranked list
    with no explanation of what was excluded.
    """
    out: list[str] = []
    if platform:
        out.append(f"platform is {platform}")
    if niche:
        out.append(f'niche contains "{niche}"')
    if budget_min is not None and budget_max is not None:
        out.append(f"price between Rs.{budget_min:,} and Rs.{budget_max:,}")
    elif budget_max is not None:
        out.append(f"price at most Rs.{budget_max:,}")
    elif budget_min is not None:
        out.append(f"price at least Rs.{budget_min:,}")
    if min_followers is not None:
        out.append(f"at least {min_followers:,} followers")
    if max_followers is not None:
        out.append(f"at most {max_followers:,} followers")
    if real_price_only:
        out.append("quoted price only (no KNN estimates)")
    if min_confidence is not None:
        out.append(f"data confidence at least {min_confidence}/100")
    return out
