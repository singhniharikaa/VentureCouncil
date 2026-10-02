"""
Contract rules: a critical clause must force "high risk" no matter what the
model said.

Found live: a fair deal wrapped in perpetual usage rights, 24 months of
uncompensated exclusivity, Net-90 payment and no kill fee was rated only
"medium risk" by the model, so the Supervisor's veto never fired and the deal
was ACCEPTED. These tests pin the fixed rule that now closes that gap.
"""
import pytest

from app.contract import CRITICAL_SCORE_CAP, apply_contract_rules, scan_contract
from app.supervisor import run as supervise
from tests.conftest import agent

NASTY = (
    "The Brand receives perpetual, worldwide, unlimited usage rights to all content "
    "in any medium. Creator grants exclusivity across all beverage and food categories "
    "for 24 months with no additional compensation. Payment is Net-90 after all "
    "deliverables. Brand may cancel at any time with no kill fee and may withhold "
    "payment at its sole discretion."
)

REASONABLE = (
    "Creator will publish one integrated mention within 14 days of brief approval. "
    "Brand receives 90 days of usage rights on the brand's own channels. Payment is "
    "Net-30 on delivery. Either party may cancel with 7 days notice and a 50% kill fee."
)


# ------------------------------------------------------------ the scan

def test_the_nasty_contract_has_critical_clauses():
    scan = scan_contract(NASTY)
    assert "Perpetual / unlimited usage rights" in scan["critical"]
    assert "Exclusivity with no stated compensation" in scan["critical"]


def test_soft_flags_are_reported_but_not_critical():
    scan = scan_contract(NASTY)
    assert "Net-60 or longer payment terms" in scan["flags"]
    assert "No kill fee on cancellation" in scan["flags"]
    assert "Net-60 or longer payment terms" not in scan["critical"]
    assert "No kill fee on cancellation" not in scan["critical"]


def test_a_reasonable_contract_trips_nothing_critical():
    """A rule that fires on every ordinary contract would be noise, not a safeguard."""
    scan = scan_contract(REASONABLE)
    assert scan["critical"] == []


@pytest.mark.parametrize("text", [None, "", "   \n  "])
def test_no_contract_text_is_a_clean_scan(text):
    assert scan_contract(text) == {"flags": [], "critical": []}


@pytest.mark.parametrize(
    "clause",
    ["Brand is granted usage in perpetuity.",
     "Rights are unlimited usage across all media.",
     "Creator agrees to assignment of the account to the Brand."],
)
def test_each_unacceptable_clause_is_critical_on_its_own(clause):
    assert scan_contract(clause)["critical"]


def test_exclusivity_alone_is_not_critical():
    """Exclusivity is normal when it is paid for; only the unpaid kind is a red flag."""
    scan = scan_contract("Creator will not promote competing energy drinks for 30 days, "
                         "for an agreed exclusivity fee of Rs.10,000.")
    assert scan["critical"] == []
    assert "Exclusivity clause present" in scan["flags"]


def test_uncompensated_exclusivity_is_critical():
    scan = scan_contract("Exclusivity applies for 12 months without additional compensation.")
    assert "Exclusivity with no stated compensation" in scan["critical"]


def test_the_redundant_exclusivity_flag_is_dropped():
    flags = scan_contract("Exclusivity for 12 months with no additional compensation.")["flags"]
    assert "Exclusivity with no stated compensation" in flags
    assert "Exclusivity clause present" not in flags


# --------------------------------------------- overriding the model's answer

def test_a_critical_clause_forces_high_risk_even_when_the_model_said_medium():
    """This is the exact live failure: the model said 'medium risk', score 40."""
    out = apply_contract_rules(agent(40, "medium risk"), NASTY)
    assert out["verdict_component"] == "high risk"
    assert out["contract_rule_applied"] is True


def test_the_score_is_capped_not_raised():
    assert apply_contract_rules(agent(90, "low risk"), NASTY)["score"] == CRITICAL_SCORE_CAP
    # an already-worse score is left alone rather than being "improved" to 30
    assert apply_contract_rules(agent(10, "high risk"), NASTY)["score"] == 10


def test_the_explanation_says_a_rule_not_the_ai_did_it():
    out = apply_contract_rules(agent(40, "medium risk", reasoning="Looks mostly fine."), NASTY)
    assert "Looks mostly fine." in out["reasoning"]          # the model's text is kept
    assert "fixed rule, not the AI" in out["reasoning"]      # and the override is disclosed
    assert "Perpetual" in out["reasoning"]


def test_a_reasonable_contract_leaves_the_models_answer_alone():
    original = agent(92, "low risk")
    out = apply_contract_rules(original, REASONABLE)
    assert out["verdict_component"] == "low risk"
    assert out["score"] == 92
    assert "contract_rule_applied" not in out


def test_no_contract_leaves_the_models_answer_alone():
    out = apply_contract_rules(agent(92, "low risk"), None)
    assert out["verdict_component"] == "low risk" and out["score"] == 92
    assert out["contract_flags"] == []


def test_the_models_original_output_is_not_mutated():
    original = agent(40, "medium risk")
    apply_contract_rules(original, NASTY)
    assert original["verdict_component"] == "medium risk" and original["score"] == 40


# ------------------------------------- all the way through to the verdict

def good_deal_with(risk_result):
    return {
        "audience_fit_result": agent(85), "engagement_result": agent(37),
        "pricing_result": agent(70), "negotiation_result": agent(100),
        "risk_result": risk_result,
    }


def test_a_great_deal_with_a_nasty_contract_can_no_longer_be_accepted():
    """The headline rule, end to end - the case that was ACCEPTED live."""
    before = supervise(good_deal_with(agent(40, "medium risk")))["verdict"]
    assert before["verdict"] == "Accept"                       # the old, wrong result

    after = supervise(good_deal_with(apply_contract_rules(agent(40, "medium risk"), NASTY)))["verdict"]
    assert after["verdict"] == "Negotiate"
    assert after["hard_rule_applied"] is True


def test_the_same_deal_with_a_reasonable_contract_is_still_accepted():
    """The rule must bite only when it should."""
    result = apply_contract_rules(agent(92, "low risk"), REASONABLE)
    out = supervise(good_deal_with(result))["verdict"]
    assert out["verdict"] == "Accept" and out["hard_rule_applied"] is False
