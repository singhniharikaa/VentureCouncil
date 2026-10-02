"""
Campaign: budget arithmetic and orchestration.

The arithmetic is plain Python with no AI in it, so these tests pin it exactly.
The orchestration tests replace the evaluation with a stub - what matters here
is that one creator failing does not sink the others, and that every selected
creator is evaluated through the same code path as a single deal.
"""
import pytest

from app.campaign import aggregate_budget, suggest_within_budget


def row(name, offer, decision, cid=None):
    return {"creator_id": cid or name, "name": name, "offer": offer, "decision": decision}


# ------------------------------------------------------------ the totals

def test_accept_is_committed_negotiate_is_tentative_reject_is_nothing():
    out = aggregate_budget(
        [row("a", 30_000, "accept"), row("b", 20_000, "negotiate"), row("c", 50_000, "reject")],
        100_000,
    )
    assert out["committed"] == 30_000
    assert out["tentative"] == 20_000
    assert out["if_all_close"] == 50_000
    assert out["counts"] == {"accept": 1, "negotiate": 1, "reject": 1, "error": 0}


def test_rejected_deals_never_touch_the_budget():
    out = aggregate_budget([row("a", 90_000, "reject")], 100_000)
    assert out["committed"] == 0 and out["tentative"] == 0
    assert out["remaining"] == 100_000


def test_remaining_is_budget_minus_committed_only():
    out = aggregate_budget([row("a", 30_000, "accept"), row("b", 20_000, "negotiate")], 100_000)
    assert out["remaining"] == 70_000                 # negotiate not yet spent
    assert out["remaining_if_all_close"] == 50_000    # but shown if it does


# --------------------------------------------------------- going over budget

def test_committed_over_budget_is_flagged():
    out = aggregate_budget([row("a", 60_000, "accept"), row("b", 60_000, "accept")], 100_000)
    assert out["over_budget"] is True
    assert out["remaining"] == -20_000


def test_tentative_can_push_it_over_even_when_committed_is_fine():
    out = aggregate_budget([row("a", 60_000, "accept"), row("b", 60_000, "negotiate")], 100_000)
    assert out["over_budget"] is False
    assert out["tentative_over_budget"] is True


def test_exactly_on_budget_is_not_over():
    out = aggregate_budget([row("a", 100_000, "accept")], 100_000)
    assert out["over_budget"] is False and out["remaining"] == 0


# ------------------------------------------------------ the running total

def test_running_total_shows_which_creator_tips_it_over():
    out = aggregate_budget(
        [row("a", 40_000, "accept"), row("b", 40_000, "accept"), row("c", 40_000, "accept")],
        100_000,
    )
    assert [r["fits_budget"] for r in out["rows"]] == [True, True, False]
    assert [r["running_total"] for r in out["rows"]] == [40_000, 80_000, 120_000]


def test_rejected_rows_carry_no_running_total():
    out = aggregate_budget([row("a", 10_000, "reject"), row("b", 10_000, "accept")], 50_000)
    assert out["rows"][0]["running_total"] is None
    assert out["rows"][1]["running_total"] == 10_000


def test_row_order_is_the_order_the_brand_gave():
    names = [r["name"] for r in aggregate_budget(
        [row("z", 1, "accept"), row("a", 1, "accept")], 10)["rows"]]
    assert names == ["z", "a"]


# --------------------------------------------------- no budget / bad input

@pytest.mark.parametrize("budget", [None, 0])
def test_no_budget_means_no_remaining_and_no_flags(budget):
    out = aggregate_budget([row("a", 30_000, "accept")], budget)
    assert out["total_budget"] is None
    assert out["remaining"] is None
    assert out["over_budget"] is False
    assert out["rows"][0]["fits_budget"] is None
    assert out["committed"] == 30_000       # still totals what was committed


def test_a_failed_evaluation_counts_as_an_error_not_as_money():
    out = aggregate_budget([row("a", 30_000, "error"), row("b", 10_000, "accept")], 100_000)
    assert out["counts"]["error"] == 1
    assert out["committed"] == 10_000


def test_empty_campaign():
    out = aggregate_budget([], 100_000)
    assert out["committed"] == 0 and out["remaining"] == 100_000 and out["rows"] == []


# ----------------------------------------------------------- orchestration

@pytest.fixture
def server():
    import api.server as srv
    return srv


def fake_eval(decision_by_id):
    def _run(req):
        return {"verdict": {"decision": decision_by_id[req.creatorId]},
                "agents": [], "comps": [], "creator": {}, "meta": {}}
    return _run


def stub_offers(monkeypatch, srv, prices):
    monkeypatch.setattr(srv, "_resolve_offer",
                        lambda cid, amt: (amt or prices[cid], f"name-{cid}"))

    def no_db():
        raise RuntimeError("no db in unit tests")

    # the market-rate lookup inside the worker would hit the DB; it falls back
    monkeypatch.setattr(srv, "get_connection", no_db)


def test_every_selected_creator_is_evaluated(server, monkeypatch):
    stub_offers(monkeypatch, server, {"cr_1": 10_000, "cr_2": 20_000, "cr_3": 30_000})
    monkeypatch.setattr(server, "run_evaluation",
                        fake_eval({"cr_1": "accept", "cr_2": "negotiate", "cr_3": "reject"}))
    out = server.run_campaign(server.CampaignRequest(
        creators=[{"creatorId": "cr_1"}, {"creatorId": "cr_2"}, {"creatorId": "cr_3"}],
        brandName="Acme", totalBudget=100_000))
    assert [r["status"] for r in out["results"]] == ["ok", "ok", "ok"]
    assert out["budget"]["committed"] == 10_000
    assert out["budget"]["tentative"] == 20_000


def test_results_keep_the_order_creators_were_given(server, monkeypatch):
    stub_offers(monkeypatch, server, {"cr_9": 1, "cr_2": 2, "cr_5": 3})
    monkeypatch.setattr(server, "run_evaluation",
                        fake_eval({"cr_9": "accept", "cr_2": "accept", "cr_5": "accept"}))
    out = server.run_campaign(server.CampaignRequest(
        creators=[{"creatorId": "cr_9"}, {"creatorId": "cr_2"}, {"creatorId": "cr_5"}],
        brandName="Acme", totalBudget=100))
    assert [r["creatorId"] for r in out["results"]] == ["cr_9", "cr_2", "cr_5"]


def test_one_creator_failing_does_not_sink_the_campaign(server, monkeypatch):
    stub_offers(monkeypatch, server, {"cr_1": 10_000, "cr_2": 20_000})

    def flaky(req):
        if req.creatorId == "cr_1":
            raise RuntimeError("groq exploded")
        return {"verdict": {"decision": "accept"}, "agents": [], "comps": [],
                "creator": {}, "meta": {}}

    monkeypatch.setattr(server, "run_evaluation", flaky)
    out = server.run_campaign(server.CampaignRequest(
        creators=[{"creatorId": "cr_1"}, {"creatorId": "cr_2"}],
        brandName="Acme", totalBudget=100_000))
    assert out["results"][0]["status"] == "error"
    assert "groq exploded" in out["results"][0]["error"]
    assert out["results"][1]["status"] == "ok"
    assert out["budget"]["committed"] == 20_000          # only the creator that worked
    assert out["budget"]["counts"]["error"] == 1


def test_an_explicit_amount_overrides_the_listed_price(server, monkeypatch):
    stub_offers(monkeypatch, server, {"cr_1": 10_000})
    monkeypatch.setattr(server, "run_evaluation", fake_eval({"cr_1": "accept"}))
    out = server.run_campaign(server.CampaignRequest(
        creators=[{"creatorId": "cr_1", "amountInr": 42_000}],
        brandName="Acme", totalBudget=100_000))
    assert out["results"][0]["offerInr"] == 42_000


def test_more_than_five_creators_is_rejected(server):
    with pytest.raises(Exception):
        server.CampaignRequest(
            creators=[{"creatorId": f"cr_{i}"} for i in range(6)], brandName="Acme")


def test_an_empty_campaign_is_rejected(server):
    with pytest.raises(Exception):
        server.CampaignRequest(creators=[], brandName="Acme")


# ------------------------------------------------ "who fits my budget?"

def ranked(*prices):
    """Candidates in rank order (best match first), ids c1, c2, ..."""
    return [{"id": f"c{i + 1}", "price": p} for i, p in enumerate(prices)]


def test_takes_best_matches_first_while_they_fit():
    out = suggest_within_budget(ranked(30_000, 20_000, 10_000), 100_000)
    assert out["ids"] == ["c1", "c2", "c3"]
    assert out["total"] == 60_000 and out["remaining"] == 40_000


def test_stops_when_the_budget_runs_out():
    out = suggest_within_budget(ranked(40_000, 40_000, 40_000), 100_000)
    assert out["ids"] == ["c1", "c2"]                # a third would be 120k
    assert out["total"] == 80_000


def test_a_creator_that_does_not_fit_is_skipped_not_the_end_of_the_list():
    """A cheaper match further down can still fit - skipping, not stopping."""
    out = suggest_within_budget(ranked(50_000, 80_000, 30_000, 15_000), 100_000)
    assert out["ids"] == ["c1", "c3", "c4"]          # c2 (80k) skipped; c3, c4 still fit
    assert out["skipped"] == 1


def test_match_quality_beats_head_count():
    """
    Greedy on rank, not on the most creators: the best match is taken even
    though skipping it would have fitted more cheap creators in.
    """
    out = suggest_within_budget(ranked(90_000, 10_000, 10_000, 10_000), 100_000)
    assert out["ids"][0] == "c1"
    assert out["total"] <= 100_000


def test_never_exceeds_the_budget():
    for budget in (1, 5_000, 25_000, 99_999, 100_000):
        out = suggest_within_budget(ranked(30_000, 25_000, 20_000, 10_000, 5_000, 1_000), budget)
        assert out["total"] <= budget
        assert out["remaining"] == budget - out["total"]


def test_respects_the_creator_limit():
    out = suggest_within_budget(ranked(*[1_000] * 10), 1_000_000, max_creators=3)
    assert out["count"] == 3 and out["ids"] == ["c1", "c2", "c3"]


def test_default_limit_is_five():
    assert suggest_within_budget(ranked(*[1_000] * 10), 1_000_000)["count"] == 5


def test_nobody_fits():
    out = suggest_within_budget(ranked(200_000, 150_000), 100_000)
    assert out["ids"] == [] and out["total"] == 0 and out["remaining"] == 100_000
    assert out["skipped"] == 2


def test_unpriced_creators_are_never_suggested():
    """A budget cannot be checked against an unknown cost."""
    out = suggest_within_budget(
        [{"id": "a", "price": None}, {"id": "b", "price": 0}, {"id": "c", "price": 10_000}], 100_000)
    assert out["ids"] == ["c"]


def test_exactly_the_budget_fits():
    assert suggest_within_budget(ranked(100_000), 100_000)["ids"] == ["c1"]


@pytest.mark.parametrize("budget", [None, 0, -5])
def test_no_usable_budget_suggests_nothing(budget):
    out = suggest_within_budget(ranked(10_000), budget)
    assert out["ids"] == [] and out["remaining"] is None


def test_empty_candidate_list():
    assert suggest_within_budget([], 100_000)["ids"] == []
