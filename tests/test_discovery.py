"""
Path A discovery — query construction.

These tests run against a fake cursor that records what was executed, so they
need no database. What they pin down is exactly the three things CLAUDE.md
records as having silently broken vector search before:

  * the embedding is bound as a STRING, not a list (gotcha #4)
  * ivfflat probes are raised before the search (gotcha #5)
  * via SET LOCAL, in the SAME transaction as the SELECT (gotcha #6)

All three fail silently in production — the query still returns rows, just
fewer and wrong ones — so there is no error to notice. A unit test is the only
cheap place to catch a regression.
"""
import pytest

from app import discovery
from app.config import VECTOR_PROBES_SQL


class FakeCursor:
    def __init__(self, rows, description):
        self._rows = rows
        self.description = description
        self.executed: list[tuple[str, list]] = []

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchall(self):
        return self._rows

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class FakeConn:
    def __init__(self, rows=(), columns=None):
        columns = columns or [
            "creator_id", "name", "platform", "niche", "followers_count",
            "engagement_rate", "price_inr", "price_estimated",
            "data_confidence_score", "profile_url", "similarity",
        ]
        self.cur = FakeCursor(list(rows), [(c,) for c in columns])

    def cursor(self):
        return self.cur


@pytest.fixture(autouse=True)
def stub_embedding(monkeypatch):
    """Avoid loading the 90 MB sentence-transformers model in unit tests."""
    monkeypatch.setattr(discovery, "embed_text", lambda text: [0.1, 0.2, 0.3])


def run(conn, brief="mobile gaming energy drink launch", **kw):
    return discovery.discover_creators(conn, brief, **kw)


def sql_of(conn):
    return conn.cur.executed[-1][0]


def params_of(conn):
    return conn.cur.executed[-1][1]


def where_of(conn):
    """Just the WHERE clause. The SELECT list mentions price columns too, so
    asserting against the whole statement gives false positives."""
    sql = sql_of(conn)
    return sql[sql.index("WHERE"):sql.index("ORDER BY")]


# ----------------------------------------------------- the three gotchas

def test_probes_are_raised_before_the_search(conn=None):
    """Gotcha #5: without this the search returns ~8 arbitrary rows."""
    conn = FakeConn()
    run(conn)
    first_sql = conn.cur.executed[0][0]
    assert first_sql == VECTOR_PROBES_SQL
    assert "SET LOCAL" in first_sql          # gotcha #6, not a session SET
    assert len(conn.cur.executed) == 2       # probes, then the query


def test_probes_and_query_share_one_cursor_and_transaction():
    """SET LOCAL only applies to the transaction it runs in."""
    conn = FakeConn()
    run(conn)
    # Both statements went through the same cursor object.
    assert len(conn.cur.executed) == 2
    assert "SELECT" in conn.cur.executed[1][0]


def test_embedding_is_bound_as_a_string_not_a_list():
    """Gotcha #4: a list becomes ARRAY[...] and will not cast to vector."""
    conn = FakeConn()
    run(conn)
    bound = params_of(conn)
    assert isinstance(bound[0], str)
    assert bound[0].startswith("[") and bound[0].endswith("]")
    assert not isinstance(bound[0], list)


def test_embedding_is_bound_for_both_select_and_order_by():
    conn = FakeConn()
    run(conn)
    bound = params_of(conn)
    assert bound[0] == bound[-2]  # same vector for similarity and ordering


# ------------------------------------------------------------- filtering

def test_no_filters_searches_the_whole_roster():
    conn = FakeConn()
    run(conn)
    where = where_of(conn)
    assert "platform =" not in where
    assert "price_inr" not in where
    assert "embedding IS NOT NULL" in where
    # params are [vector, *filters, vector, limit] -> no filters in between
    assert params_of(conn)[1:-2] == []


def test_platform_filter_is_a_where_clause():
    conn = FakeConn()
    run(conn, platform="instagram")
    assert "platform = %s" in where_of(conn)
    assert "instagram" in params_of(conn)


def test_budget_ceiling_filters_out_unaffordable_creators():
    """The whole point: do not spend five LLM calls on a creator over budget."""
    conn = FakeConn()
    run(conn, budget_max=50_000)
    assert "price_inr <= %s" in where_of(conn)
    assert 50_000 in params_of(conn)


def test_budget_range_applies_both_bounds():
    conn = FakeConn()
    run(conn, budget_min=10_000, budget_max=50_000)
    where = where_of(conn)
    assert "price_inr <= %s" in where and "price_inr >= %s" in where


def test_unpriced_creators_survive_a_budget_filter():
    """A missing price is unknown, not 'too expensive' — do not drop silently."""
    conn = FakeConn()
    run(conn, budget_max=50_000)
    assert "price_inr IS NULL OR" in where_of(conn)


def test_niche_matches_sub_niches_too():
    """The roster stores 'gaming / FF'; asking for 'gaming' must still match."""
    conn = FakeConn()
    run(conn, niche="gaming")
    assert "niche ILIKE %s" in where_of(conn)
    assert "%gaming%" in params_of(conn)


def test_real_price_only_excludes_knn_estimates():
    conn = FakeConn()
    run(conn, real_price_only=True)
    assert "price_estimated = false" in where_of(conn)


def test_real_price_only_is_off_by_default():
    conn = FakeConn()
    run(conn)
    assert "price_estimated = false" not in where_of(conn)


def test_follower_and_confidence_bounds():
    conn = FakeConn()
    run(conn, min_followers=10_000, max_followers=1_000_000, min_confidence=50)
    where = where_of(conn)
    assert "followers_count >= %s" in where and "followers_count <= %s" in where
    assert "data_confidence_score >= %s" in where
    for v in (10_000, 1_000_000, 50):
        assert v in params_of(conn)


def test_contact_details_are_never_selected():
    """This result set is served over the API; whatsapp has no part in matching."""
    conn = FakeConn()
    run(conn)
    assert "whatsapp" not in sql_of(conn).lower()


# ---------------------------------------------------------------- limits

@pytest.mark.parametrize("asked, expected", [(5, 5), (0, 1), (-10, 1), (10_000, discovery.MAX_LIMIT)])
def test_limit_is_clamped(asked, expected):
    conn = FakeConn()
    run(conn, limit=asked)
    assert params_of(conn)[-1] == expected


# ----------------------------------------------------------- the results

def test_similarity_and_distance_are_returned():
    conn = FakeConn(rows=[(43, "Bulky", "youtube", "gaming", 302_000, 2.94,
                           30_000, False, 100, "", 0.8291)])
    out = run(conn)
    assert out[0]["similarity"] == pytest.approx(0.8291)
    assert out[0]["distance"] == pytest.approx(0.1709)
    assert out[0]["name"] == "Bulky"


def test_null_similarity_does_not_crash():
    conn = FakeConn(rows=[(1, "x", "youtube", None, 0, None, None, True, 25, "", None)])
    out = run(conn)
    assert out[0]["similarity"] is None and out[0]["distance"] is None


# --------------------------------------------------------- query shaping

def test_brief_is_enriched_with_structured_hints():
    """
    creators.embedding was built from a fixed template, not prose, so a bare
    brand brief sits far away in vector space. Measured: a gaming brief scored
    0.274 and returned cricket creators; rebuilt in the template it scored
    0.654 and returned gaming creators.
    """
    q = discovery.build_query_text("we sell energy drinks", niche="gaming",
                                   platform="youtube")
    assert "we sell energy drinks" in q
    assert "gaming niche" in q
    assert "youtube creator" in q


def test_template_leads_and_the_brief_follows():
    """The structured half is what the vectors actually encode."""
    q = discovery.build_query_text("we sell energy drinks", niche="gaming",
                                   platform="youtube")
    assert q.index("youtube creator") < q.index("we sell energy drinks")


@pytest.mark.parametrize(
    "budget, band",
    [(10_000, "under 15k"), (15_000, "under 15k"), (25_000, "15k-30k"),
     (50_000, "30k-50k"), (90_000, "50k-100k"), (500_000, "100k+")],
)
def test_budget_maps_onto_the_seeded_price_bands(budget, band):
    """These labels must match the seeded embedding_text exactly."""
    q = discovery.build_query_text("x", budget_max=budget)
    assert f"price around {band}" in q


@pytest.mark.parametrize(
    "followers, bucket",
    [(20_000, "under 50k"), (120_000, "50k-200k"), (300_000, "200k-500k"),
     (800_000, "500k-1m"), (5_000_000, "1m+")],
)
def test_follower_ceiling_maps_onto_the_seeded_buckets(followers, bucket):
    q = discovery.build_query_text("x", max_followers=followers)
    assert f"{bucket} followers" in q


def test_structured_hints_are_omitted_when_not_given():
    q = discovery.build_query_text("just the brief")
    assert q == "just the brief"


def test_filters_feed_the_query_text_not_just_the_where_clause():
    """A budget ceiling should steer the ranking, not only exclude rows."""
    captured = {}
    import app.discovery as d

    real = d.build_query_text

    def spy(brief, **kw):
        captured.update(kw)
        return real(brief, **kw)

    conn = FakeConn()
    original = d.build_query_text
    d.build_query_text = spy
    try:
        run(conn, platform="youtube", niche="gaming", budget_max=50_000,
            max_followers=200_000)
    finally:
        d.build_query_text = original

    assert captured["budget_max"] == 50_000
    assert captured["max_followers"] == 200_000
    assert captured["platform"] == "youtube"


def test_brief_alone_is_left_untouched():
    assert discovery.build_query_text("  energy drinks  ") == "energy drinks"


# ------------------------------------------------------- filter summary

def test_filter_summary_explains_what_was_excluded():
    out = discovery.summarise_filters(platform="instagram", budget_max=50_000,
                                      real_price_only=True)
    joined = " | ".join(out)
    assert "instagram" in joined
    assert "Rs.50,000" in joined
    assert "KNN" in joined


def test_filter_summary_is_empty_when_nothing_was_applied():
    assert discovery.summarise_filters() == []


# --------------------------------------------------------- tie-breaking

def test_ties_break_on_data_quality_then_reach():
    """
    The template encodes five coarse buckets, so creators in the same bucket
    score almost identically. Without an explicit tie-break the order within a
    tie is arbitrary — which surfaced a 2-follower channel in third place.
    """
    conn = FakeConn()
    run(conn)
    sql = sql_of(conn)
    order_by = sql[sql.index("ORDER BY"):]
    assert "embedding <=> %s::vector" in order_by
    assert "data_confidence_score DESC" in order_by
    assert "followers_count DESC" in order_by
    # similarity must remain the primary key
    assert order_by.index("embedding <=>") < order_by.index("data_confidence_score")
