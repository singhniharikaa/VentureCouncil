"""
Shared setup used across every agent: Supabase connection, the embedding
model (for pgvector search), and the LLM used for agent reasoning.

Keys are read from the .env file in the project root (gitignored) - never
hardcode them here, this file IS committed.

    LLM_PROVIDER=gemini|grok    which provider the agents talk to
    GEMINI_API_KEY=...          needed when LLM_PROVIDER=gemini
    GROK_API_KEY=...            needed when LLM_PROVIDER=grok

Only the selected provider's key is required, so you can run on Grok without
a Gemini key and vice versa. The actual LLM calls live in app/llm.py.
"""
import os

import psycopg2
from dotenv import load_dotenv
from sentence_transformers import SentenceTransformer

# Loads key=value pairs from a .env file in the project root, if present.
# .env is gitignored - put your keys there once and never re-enter them.
load_dotenv()

# The Supabase connection string contains a live database password, so it is
# read from .env and never hardcoded here — app/config.py IS committed.
SUPABASE_CONN_STRING = os.environ.get("SUPABASE_CONN_STRING")
if not SUPABASE_CONN_STRING:
    raise RuntimeError(
        "SUPABASE_CONN_STRING is not set. Copy .env.example to .env and paste the "
        "connection string from your Supabase project "
        "(Project Settings > Database > Connection string > Transaction pooler, port 6543)."
    )

# Re-exported so existing imports (`from app.config import call_llm_json`)
# keep working unchanged. Provider selection and retry/backoff live in llm.py.
from app.llm import call_llm_json, model_name, provider  # noqa: E402

_embed_model = None


def get_connection():
    """Fresh connection per call - safest for short-lived scripts."""
    return psycopg2.connect(SUPABASE_CONN_STRING)


# Every pgvector similarity query MUST run this first, in its own transaction.
#
# Why: the ivfflat indexes on creators/past_deals were built with pgvector's
# default lists=100. On tables this small (775 and 61 rows) that leaves under
# ~8 rows per list, so the default ivfflat.probes=1 makes a top-k search
# silently return FEWER and WORSE rows than requested - past_deals returned
# 3 rows for a LIMIT 5, and the 3 it returned were not the nearest neighbours.
#
# Why SET LOCAL and not a session-level SET: the Supabase connection string
# uses the pooler on port 6543 (pgbouncer, transaction mode), so consecutive
# transactions may land on different backends. A session SET appears to work
# in sequential scripts but is silently lost once the graph runs its agents
# in parallel. SET LOCAL is scoped to the current transaction, which is
# always one backend. Requires autocommit=False (psycopg2's default).
VECTOR_PROBES_SQL = "SET LOCAL ivfflat.probes = 100"


def get_embed_model():
    global _embed_model
    if _embed_model is None:
        _embed_model = SentenceTransformer('all-MiniLM-L6-v2')
    return _embed_model


def embed_text(text: str) -> list:
    return get_embed_model().encode(text).tolist()
