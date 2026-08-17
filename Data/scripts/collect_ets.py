"""Collector 1 -- ETS official scored sample responses (Priority 1).

ETS publishes real test-taker responses at every score point (6..1) together
with the official rater commentary. These are the highest-confidence records in
the corpus: the score is an official ETS rating and ETS states explicitly that
the responses are "reproduced exactly as written", i.e. genuine human writing.

Sources handled here (all PDFs downloaded from ets.org):
  sample-issue-task.pdf      6 responses  (Issue: technology / think for themselves)
  sample-argument-task.pdf   6 responses  (Argument: Mason River)
  ets_pt3.pdf                12 responses (Practice Test 3, Issue + Argument)
  ets_ptresp1.pdf            6 responses  (Practice Test 1, Issue)
  ets_ptresp3.pdf            6 responses  (Practice Test 3, accessible edition)
"""
from __future__ import annotations

import os
import re
import sys

from pypdf import PdfReader

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import CACHE_DIR, clean_text, make_record, save_stage, word_count  # noqa: E402

ETS_URLS = {
    "sample-issue-task.pdf":
        "https://www.ets.org/content/dam/ets-org/pdfs/gre/sample-issue-task.pdf",
    "sample-argument-task.pdf":
        "https://www.ets.org/content/dam/ets-org/pdfs/gre/sample-argument-task.pdf",
    "ets_pt3.pdf":
        "https://www.ets.org/pdfs/gre/gre-practice-test-3%20writing-responses-18-point.pdf",
    "ets_ptresp1.pdf":
        "https://www.ets.org/content/dam/ets-india/pdfs/gre/"
        "gre-practice-test-1-writing-responses-18-point.pdf",
    "ets_ptresp3.pdf":
        "https://www.ets.org/content/dam/ets-india/pdfs/gre/"
        "gre-practice-test-3-writing-responses-18-point.pdf",
}

EVID_HUMAN = (
    "ETS official publication; ETS states 'All responses are reproduced exactly as "
    "written, including errors, misspellings, etc.' -- genuine test-taker responses "
    "published long before generative-AI tools existed."
)
EVID_SCORE = (
    "Score assigned by official ETS GRE raters and published by ETS alongside the "
    "response, with rater commentary explaining the score."
)

# Boilerplate that PDF headers/footers inject into the extracted text.
NOISE = [
    re.compile(r"^\s*-\s*\d+\s*-\s*$"),
    re.compile(r"^\s*\d{1,2}\s*$"),
    re.compile(r"GRE\s*General\s*$", re.I),
    re.compile(r"^\[This footer should NOT be printed\.\]"),
    re.compile(r"^LT\d+-", re.I),
    re.compile(r"^\s*$"),
]


def read_pdf(name: str) -> str:
    path = os.path.join(CACHE_DIR, name)
    reader = PdfReader(path)
    return "\n".join(p.extract_text() or "" for p in reader.pages)


def strip_noise(block: str) -> str:
    keep = []
    for line in block.split("\n"):
        if any(rx.search(line) for rx in NOISE):
            continue
        keep.append(line.strip())
    # PDF line-wrapping: rejoin lines into paragraphs.
    text = " ".join(keep)
    text = re.sub(r"\s+", " ", text)
    return clean_text(text)


def split_paragraphs(text: str) -> str:
    """Re-introduce paragraph breaks at sentence-end + capital heuristics."""
    return text


# ------------------------------------------------------- per-PDF extractors

def parse_sample_task(name: str, essay_type: str, source_url: str):
    """sample-issue-task.pdf / sample-argument-task.pdf layout."""
    raw = read_pdf(name)

    m = re.search(r"measure:(.*?)Strategies for th", raw, re.S | re.I)
    prompt = strip_noise(m.group(1)) if m else ""

    # NB: "Rater Commentary for Essay Response - Score N" also contains the
    # heading text, so require that the heading is not preceded by "for ".
    parts = re.split(r"(?<!for )Essay Response\s*[—–\-]\s*Score\s*(\d)", raw)
    out = []
    for i in range(1, len(parts), 2):
        score = int(parts[i])
        body = parts[i + 1]
        body = re.split(r"Rater Commentary for Essay Response", body)[0]
        essay = strip_noise(body)
        if word_count(essay) < 10:
            continue
        out.append(make_record(
            essay_id=f"ets_{name.replace('.pdf','')}_score{score}",
            essay_text=essay,
            essay_type=essay_type,
            prompt_text=prompt,
            prompt_category="ETS official published prompt",
            score=float(score),
            score_type="official",
            score_scale="0-6",
            human_authenticity="confirmed",
            exam_or_practice="official_scored_sample",
            author_username="",
            source_name="ETS (ets.org) official GRE Analytical Writing sample responses",
            source_url=source_url,
            publication_date="",
            evidence_for_score=EVID_SCORE,
            evidence_for_human_authorship=EVID_HUMAN,
            notes=f"Extracted from {name}. Published with official rater commentary.",
        ))
    return out


def parse_practice_test(name: str, source_url: str, label: str):
    """Practice-test PDFs: 'The following sample [issue|argument] response
    received a score of N:' ... next marker."""
    raw = read_pdf(name)

    # Prompts: 'Sample Topic:' blocks, or the issue/argument statements.
    prompts = {}
    for kind, rx in (
        ("issue", re.compile(r"Sample Responses to the Issue Topic", re.I)),
        ("argument", re.compile(r"Sample Responses to the Argument Topic", re.I)),
    ):
        prompts[kind] = ""
    m = re.search(r"Sample Topic:(.*?)(?:GRE\s*.?\s*Scoring Guide|Score 6)", raw, re.S)
    generic_prompt = strip_noise(m.group(1)) if m else ""

    marker = re.compile(
        r"The following sample\s*(issue|argument)?\s*response received a\s*"
        r"score\s*of\s*(\d)\s*:", re.I | re.S)
    hits = list(marker.finditer(raw))
    out = []
    for i, h in enumerate(hits):
        kind = (h.group(1) or "").lower()
        score = int(h.group(2))
        end = hits[i + 1].start() if i + 1 < len(hits) else len(raw)
        body = raw[h.end():end]
        # Cut off the reader commentary that follows each response.
        body = re.split(
            r"(?:Reader|Rater)\s+Commentary|Commentary on the (?:Issue|Argument)|"
            r"This (?:response|essay) (?:presents|earn|receive)",
            body)[0]
        essay = strip_noise(body)
        if word_count(essay) < 10:
            continue
        etype = kind if kind in ("issue", "argument") else guess_type(raw, h.start())
        out.append(make_record(
            essay_id=f"ets_{label}_{etype or 'na'}_{i}_score{score}",
            essay_text=essay,
            essay_type=etype or "unknown",
            prompt_text=generic_prompt if not kind else prompt_for(raw, h.start(), kind),
            prompt_category="ETS official published prompt",
            score=float(score),
            score_type="official",
            score_scale="0-6",
            human_authenticity="confirmed",
            exam_or_practice="official_scored_sample",
            source_name="ETS (ets.org) official GRE practice test sample essays",
            source_url=source_url,
            evidence_for_score=EVID_SCORE,
            evidence_for_human_authorship=EVID_HUMAN,
            notes=f"Extracted from {name} ({label}).",
        ))
    return out


def guess_type(raw: str, pos: int) -> str:
    head = raw[:pos].lower()
    li = max(head.rfind("issue topic"), head.rfind("following issue"),
             head.rfind("response to the issue"))
    la = max(head.rfind("argument topic"), head.rfind("following argument"),
             head.rfind("response to the argument"))
    if la > li:
        return "argument"
    if li >= 0:
        return "issue"
    return ""


def prompt_for(raw: str, pos: int, kind: str) -> str:
    """Find the topic statement preceding a response for PT-style PDFs."""
    head = raw[:pos]
    label = "Issue" if kind == "issue" else "Argument"
    m = list(re.finditer(
        rf"Sample {label} Topic:\s*(.*?)(?:GRE\s*.?\s*Scoring Guide|Score 6\b)",
        head, re.S | re.I))
    if not m:
        m = list(re.finditer(rf"Sample {label} Topic:\s*(.*)", head, re.S | re.I))
    if not m:
        return ""
    return strip_noise(m[-1].group(1))[:2500]


def main():
    records = []
    records += parse_sample_task("sample-issue-task.pdf", "issue",
                                 ETS_URLS["sample-issue-task.pdf"])
    records += parse_sample_task("sample-argument-task.pdf", "argument",
                                 ETS_URLS["sample-argument-task.pdf"])
    records += parse_practice_test("ets_pt3.pdf", ETS_URLS["ets_pt3.pdf"],
                                   "practice_test_3")
    records += parse_practice_test("ets_ptresp1.pdf", ETS_URLS["ets_ptresp1.pdf"],
                                   "practice_test_1")
    # ets_ptresp3.pdf is the accessible re-issue of the same Practice Test 3
    # responses already captured from ets_pt3.pdf, so it is intentionally not
    # parsed again (dedup would drop it anyway).

    for r in records:
        print(f"{r['essay_id']:<52} score={r['score']} wc={r['word_count']:>4} "
              f"type={r['essay_type']}")
    save_stage("ets", records)


if __name__ == "__main__":
    main()
