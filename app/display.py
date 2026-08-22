"""
Console output helpers.

Windows terminals default to the cp1252 codepage, which cannot encode the
smart quotes, en/em dashes and non-breaking hyphens that LLMs habitually
emit. Printing raw model output there raises UnicodeEncodeError and kills
the run *after* all the API calls have already been paid for - which is a
maximally annoying place to crash.

Every script that prints model text should call `init_stdout()` once at
startup and pass model-generated strings through `asciify()`.
"""
import sys

_ASCII_MAP = {
    0x2010: "-", 0x2011: "-", 0x2012: "-", 0x2013: "-", 0x2014: "-", 0x2015: "-",
    0x2018: "'", 0x2019: "'", 0x201a: "'", 0x201b: "'",
    0x201c: '"', 0x201d: '"', 0x201e: '"', 0x201f: '"',
    0x2026: "...", 0x2032: "'", 0x2033: '"',
    0x00a0: " ", 0x202f: " ", 0x2009: " ", 0x200b: "",
    0x20b9: "Rs.", 0x2192: "->", 0x2190: "<-",
    0x2265: ">=", 0x2264: "<=", 0x00d7: "x", 0x2022: "*",
}


def init_stdout():
    """Prefer UTF-8, and never let an unencodable character crash a run."""
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, OSError):
        pass


def asciify(text) -> str:
    """Make model output safe for a cp1252 console without losing meaning."""
    return str(text).translate(_ASCII_MAP).encode("ascii", "replace").decode("ascii")
