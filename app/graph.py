"""
Wires all 5 agents + Supervisor into a LangGraph.

Audience Fit, Engagement, Pricing, and Risk run in parallel.
Negotiation runs after Pricing (it needs the Pricing verdict).
Supervisor runs last, once everything above has finished.
"""
from langgraph.graph import StateGraph, START, END
from app.state import DealState
from app.agents import audience_fit, engagement, pricing, risk, negotiation
from app import supervisor


def build_graph():
    graph = StateGraph(DealState)

    graph.add_node("audience_fit", audience_fit.run)
    graph.add_node("engagement", engagement.run)
    graph.add_node("pricing", pricing.run)
    graph.add_node("risk", risk.run)
    graph.add_node("negotiation", negotiation.run)
    graph.add_node("supervisor", supervisor.run)

    # fan-out: these 4 all start in parallel
    graph.add_edge(START, "audience_fit")
    graph.add_edge(START, "engagement")
    graph.add_edge(START, "pricing")
    graph.add_edge(START, "risk")

    # negotiation needs pricing's output first
    graph.add_edge("pricing", "negotiation")

    # fan-in: supervisor waits for ALL of these (list-based edge = join, not 4 separate triggers)
    graph.add_edge(["audience_fit", "engagement", "negotiation", "risk"], "supervisor")

    graph.add_edge("supervisor", END)

    return graph.compile()
