"""
The written explanation of a verdict.

The one property that matters: the explanation can never change the decision.
The Supervisor decides; this layer only explains. These tests pin down that the
headline is built in code, that an answer arguing the opposite is discarded, and
that every failure of the AI path still leaves the brand with a correct
explanation.
"""
import pytest

from app import narrative
from app.narrative import (
    MAX_EXPLANATION,
    MAX_STEPS,
    build_facts,
    build_prompt,
    contradicts,
    make_headline,
    template_narrative,
    write_narrative,
)

CREATOR = {"creator_name": "Bulky", "platform": "youtube", "niche": "gaming",
           "followers_count": 302_000, "price_inr": 30_000}
STATE = {"brand_name": "GameFuel Energy", "proposed_amount": 35_000,
         "deliverable": "1 integration video"}


def agent(aid, score, rec, component="", reasoning="Looked at the data.", insufficient=False):
    return {"id": aid, "score": score, "recommendation": rec,
            "typed": {"verdict_component": component}, "reasoning": reasoning,
            "insufficientData": insufficient, "flags": []}


AGENTS = [
    agent("audience_fit", 85, "accept", "strong fit", "Gaming creator matches a gaming brand."),
    agent("engagement", 37, "reject", "weak engagement", "37th percentile among YouTube peers."),
    agent("pricing", 70, "accept", "fair", "Close to the accepted Rs.30,000 deal."),
    agent("risk", 92, "accept", "low risk", "Data confidence is perfect."),
    agent("negotiation", 100, "accept", "no negotiation needed", "No adjustment required."),
]


def verdict(decision="accept", override=False, score=68.0):
    return {"decision": decision, "weightedScore": score, "override": {"fired": override}}


def facts(decision="accept", override=False, agents=None):
    return build_facts(CREATOR, STATE, agents or AGENTS, verdict(decision, override))


GOOD_AI = {
    "explanation": ("Bulky is a strong match for GameFuel Energy because he makes gaming content on "
                    "YouTube for 302,000 followers, and the Rs.35,000 offer sits close to the "
                    "accepted Rs.30,000 deal. The one weak spot is engagement, which is below the "
                    "median for his platform."),
    "next_steps": ["Confirm payment terms in writing.", "Check the contract has no unlimited usage rights."],
}


@pytest.fixture
def ai(monkeypatch):
    """Replace the model call; returns a list that records every prompt sent."""
    sent = []

    def install(reply):
        def fake(prompt):
            sent.append(prompt)
            if isinstance(reply, Exception):
                raise reply
            return reply
        monkeypatch.setattr(narrative, "call_llm_json", fake)
        return sent

    return install


# ------------------------------------------------------------------- facts

def test_facts_work_out_how_far_the_offer_is_from_their_rate():
    f = facts()
    assert f["offer"] == 35_000 and f["rate"] == 30_000
    assert f["delta_pct"] == 17           # (35000 / 30000 - 1) = 16.7% -> 17
    assert f["decision"] == "accept"


def test_facts_cope_with_a_missing_rate():
    f = build_facts({**CREATOR, "price_inr": None}, STATE, AGENTS, verdict())
    assert f["delta_pct"] is None


# ---------------------------------------------------------------- headline

@pytest.mark.parametrize("decision", ["accept", "negotiate", "reject"])
def test_the_headline_is_built_in_code_from_the_decision(decision):
    h = make_headline(facts(decision))
    assert h.startswith(decision.upper())
    assert "Bulky" in h and "Rs.35,000" in h


# ---------------------------------------------------------------- template

def test_accept_template_is_positive_and_names_the_concern():
    out = template_narrative(facts("accept"))["explanation"]
    assert "good fit" in out
    assert "main concern is engagement" in out          # the weakest finding
    assert "17% above" in out and "Rs.30,000" in out    # real numbers from the deal


def test_negotiate_template_says_it_is_not_ready_to_sign():
    out = template_narrative(facts("negotiate"))["explanation"]
    assert "not ready to sign" in out


def test_reject_template_says_not_to_proceed():
    out = template_narrative(facts("reject"))["explanation"]
    assert "should not go ahead" in out


def test_the_policy_override_is_explained():
    assert "policy rule" in template_narrative(facts("negotiate", override=True))["explanation"]
    assert "policy rule" not in template_narrative(facts("negotiate", override=False))["explanation"]


def test_missing_data_is_disclosed_not_hidden():
    agents = [*AGENTS[:1], agent("engagement", 40, "negotiate", "unknown", insufficient=True), *AGENTS[2:]]
    out = template_narrative(facts("accept", agents=agents))["explanation"]
    assert "Not enough data was available for engagement" in out


def test_an_insufficient_agent_is_never_called_the_main_concern():
    agents = [agent("audience_fit", 85, "accept", "strong fit"),
              agent("engagement", 5, "reject", "unknown", insufficient=True),
              agent("pricing", 70, "accept", "fair"), agent("risk", 92, "accept", "low risk")]
    out = template_narrative(facts("accept", agents=agents))["explanation"]
    assert "main concern is engagement" not in out


def test_the_next_steps_follow_the_decision():
    steps = {d: template_narrative(facts(d))["next_steps"] for d in ("accept", "negotiate", "reject")}
    assert "writing" in steps["accept"][0]
    assert "Counter" in steps["negotiate"][0]
    assert "Do not proceed" in steps["reject"][0]


def test_the_template_is_labelled_as_not_ai():
    out = template_narrative(facts())
    assert out["source"] == "template" and out["model"] is None


# -------------------------------------------------------------- the AI path

def test_a_good_ai_answer_is_used(ai):
    ai(GOOD_AI)
    out = write_narrative(facts("accept"))
    assert out["source"] == "ai"
    assert out["explanation"] == GOOD_AI["explanation"]
    assert out["next_steps"] == GOOD_AI["next_steps"]
    assert "/" in out["model"]


def test_the_ai_cannot_change_the_headline(ai):
    """Even if the model volunteers its own headline, only the code-built one is used."""
    ai({**GOOD_AI, "headline": "REJECT: run away from Bulky"})
    out = write_narrative(facts("accept"))
    assert out["headline"] == make_headline(facts("accept"))
    assert out["headline"].startswith("ACCEPT")


def test_use_ai_false_never_calls_the_model(ai):
    sent = ai(RuntimeError("must not be called"))
    out = write_narrative(facts(), use_ai=False)
    assert out["source"] == "template" and sent == []


def test_a_failed_call_falls_back_to_the_template(ai):
    ai(RuntimeError("groq exploded"))
    out = write_narrative(facts())
    assert out["source"] == "template" and out["explanation"]


@pytest.mark.parametrize(
    "bad",
    [None, "just a string", ["a", "list"], {}, {"explanation": 7},
     {"explanation": "Too short to be useful."},
     {"explanation": "   ", "next_steps": []}],
    ids=["none", "string", "list", "empty", "not-text", "too-short", "blank"],
)
def test_a_malformed_ai_answer_falls_back_to_the_template(ai, bad):
    ai(bad)
    assert write_narrative(facts())["source"] == "template"


def test_an_answer_arguing_the_opposite_is_discarded(ai):
    ai({"explanation": ("Although the numbers look reasonable on paper, after weighing everything "
                        "we recommend rejecting this deal and walking away from the creator now."),
        "next_steps": ["Send a polite decline."]})
    out = write_narrative(facts("accept"))
    assert out["source"] == "template"
    assert "recommend rejecting" not in out["explanation"]


def test_next_steps_that_contradict_the_decision_discard_the_answer(ai):
    ai({**GOOD_AI, "next_steps": ["You can sign this deal as-is, immediately."]})
    assert write_narrative(facts("negotiate"))["source"] == "template"


def test_a_string_step_is_accepted_as_one_step(ai):
    ai({**GOOD_AI, "next_steps": "Confirm the payment terms in writing."})
    assert write_narrative(facts("accept"))["next_steps"] == ["Confirm the payment terms in writing."]


def test_steps_are_capped_and_text_is_clipped(ai):
    ai({"explanation": "Plausible words. " * 80, "next_steps": [f"Step number {i}." for i in range(9)]})
    out = write_narrative(facts("accept"))
    assert len(out["explanation"]) <= MAX_EXPLANATION
    assert len(out["next_steps"]) == MAX_STEPS


def test_no_steps_from_the_ai_falls_back_to_the_templates_steps(ai):
    ai({**GOOD_AI, "next_steps": []})
    assert write_narrative(facts("accept"))["next_steps"] == template_narrative(facts("accept"))["next_steps"]


# --------------------------------------------------------------- the guard

@pytest.mark.parametrize(
    "decision, text, expected",
    [
        ("accept", "Do not sign until the payment terms are confirmed in writing.", False),
        ("accept", "You should decline unlimited usage rights in the contract.", False),
        ("accept", "We recommend rejecting this deal.", True),
        ("accept", "I would decline this offer.", True),
        ("reject", "Do not proceed at this price.", False),
        ("reject", "We recommend accepting this offer.", True),
        ("negotiate", "Counter on price instead of accepting as offered.", False),
        ("negotiate", "You can sign this deal as-is.", True),
        ("negotiate", "Sign immediately.", True),
    ],
)
def test_contradiction_means_recommending_the_opposite_not_using_the_word(decision, text, expected):
    """Ordinary advice under an Accept ("do not sign until...") must not be thrown away."""
    assert contradicts(text, decision) is expected


# ------------------------------------------------------------------ prompt

def test_the_prompt_says_the_decision_is_final():
    p = build_prompt(facts("negotiate"))
    assert "ALREADY been made" in p and "NEGOTIATE" in p


def test_the_prompt_carries_every_findings_reasoning():
    p = build_prompt(facts())
    for a in AGENTS:
        assert a["reasoning"] in p


def test_the_prompt_forbids_inventing_numbers():
    assert "never invent" in build_prompt(facts())


def test_the_override_is_only_mentioned_when_it_fired():
    assert "policy rule" in build_prompt(facts("negotiate", override=True))
    assert "policy rule" not in build_prompt(facts("negotiate", override=False))
