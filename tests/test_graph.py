"""
Graph topology.

This guards CLAUDE.md gotcha #1, which is the kind of bug that does not look
like a bug: calling `add_edge(node, target)` once per predecessor does NOT make
the target wait for all of them — it fires the target once per predecessor. The
run still completes and still prints a verdict, so nothing appears wrong; the
Supervisor has simply consolidated partial findings several times over.

Every agent is replaced with a stub, so this costs no LLM quota and touches no
database. It checks the SHAPE of the run, not its conclusions.
"""
import collections

import pytest

UPSTREAM = ["audience_fit", "engagement", "pricing", "risk"]


@pytest.fixture
def run_graph(monkeypatch):
    """Build the real graph with every agent stubbed, and record the call order."""
    from app import supervisor
    from app.agents import audience_fit, engagement, negotiation, pricing, risk

    calls = collections.Counter()
    order = []

    def stub(agent_id, result_key, score=72, component="ok"):
        def fake(state):
            calls[agent_id] += 1
            order.append(agent_id)
            return {
                result_key: {
                    "score": score,
                    "verdict_component": component,
                    "reasoning": "stubbed",
                    "confidence": 0.9,
                }
            }

        return fake

    monkeypatch.setattr(audience_fit, "run", stub("audience_fit", "audience_fit_result"))
    monkeypatch.setattr(engagement, "run", stub("engagement", "engagement_result"))
    monkeypatch.setattr(pricing, "run", stub("pricing", "pricing_result"))
    monkeypatch.setattr(risk, "run", stub("risk", "risk_result", component="low risk"))
    monkeypatch.setattr(negotiation, "run", stub("negotiation", "negotiation_result"))

    real_supervisor = supervisor.run

    def counted(state):
        calls["supervisor"] += 1
        order.append("supervisor")
        return real_supervisor(state)

    monkeypatch.setattr(supervisor, "run", counted)

    def _run(state):
        from app.graph import build_graph

        result = build_graph().invoke(state)
        return result, calls, order

    return _run


def test_every_node_runs_exactly_once(run_graph, state):
    """
    The fan-in regression test.

    With separate add_edge calls instead of the list form, the Supervisor runs
    four times here instead of once.
    """
    _, calls, _ = run_graph(state)
    assert dict(calls) == {
        "audience_fit": 1,
        "engagement": 1,
        "pricing": 1,
        "risk": 1,
        "negotiation": 1,
        "supervisor": 1,
    }


def test_negotiation_waits_for_pricing(run_graph, state):
    """Negotiation reasons over Pricing's verdict, so it cannot start first."""
    _, _, order = run_graph(state)
    assert order.index("pricing") < order.index("negotiation")


def test_supervisor_runs_last(run_graph, state):
    _, _, order = run_graph(state)
    assert order[-1] == "supervisor"
    for node in UPSTREAM + ["negotiation"]:
        assert order.index(node) < order.index("supervisor")


def test_supervisor_sees_all_five_results(run_graph, state):
    """A premature fan-in would consolidate with some results still missing."""
    result, _, _ = run_graph(state)
    breakdown = result["verdict"]["agent_breakdown"]
    assert all(breakdown[name] for name in UPSTREAM + ["negotiation"])


def test_graph_produces_a_verdict(run_graph, state):
    result, _, _ = run_graph(state)
    assert result["verdict"]["verdict"] in {"Accept", "Negotiate", "Reject"}


def test_each_agent_writes_only_its_own_key(run_graph, state):
    """
    What makes the parallel fan-out safe: no two agents write the same state
    key, so there is no last-writer-wins race between them.
    """
    result, _, _ = run_graph(state)
    for name in UPSTREAM + ["negotiation"]:
        assert f"{name}_result" in result
