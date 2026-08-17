"""Collector 6 -- GRE Prep Club (MyPrepClub) AWA forum.

Test takers paste their own practice essay and ask the community for feedback.
Threads were read through the user's own logged-in browser session: anonymous
server-side requests to this domain are refused with HTTP 403 (Cloudflare).

Scores: almost none are human. What looks like an expert reply is usually a
pasted report from the `GMATAWA auto-grader` or a "Statistics / Assignment
Score" bot. Those are machine output -> score_type='estimated'. A genuine
human 0-6 rating in a reply is recorded as 'third_party_rated'; a 25-thread
sample found zero of them, so expect very few.

Input: raw_cache/gre_prepclub_awa.json, produced by the in-browser harvest.
Each element: {t: thread title, u: url, b: [post bodies], us: [usernames],
d: date string}. b[0] is the opening post, which holds prompt + essay.

Usage:
    python collect_prepclub.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (CACHE_DIR, classify_task, clean_text,  # noqa: E402
                    make_essay_id, make_record, save_stage, word_count)

RAW = os.path.join(CACHE_DIR, "gre_prepclub_awa.json")

CUTOFF_AI = "2022-11-30"  # public launch of ChatGPT

# --- paragraph recovery -----------------------------------------------------

# The browser harvest read post bodies with textContent, which concatenates
# block elements with no separator at all. Paragraph breaks therefore survive
# as *missing whitespace*: ".Furthermore" is a block boundary, while a normal
# sentence break always has a space after the stop. Splitting on that runs the
# original structure back out -- it recovers a real boundary rather than
# guessing one. Validated on 564 threads: 4.9 breaks/essay (typical GRE shape),
# and 24% of the recovered starts open with a paragraph discourse marker.
PARA_BREAK = re.compile(r'(?<=[.!?"”])(?=[A-Z"“])')
# Don't split inside initials or abbreviations ("U.S.Government", "Dr.Smith").
ABBREV = re.compile(
    r"(?:\b[A-Z]\.|\b(?:Mr|Mrs|Ms|Dr|Prof|St|Jr|Sr|vs|etc|Inc|Ltd|Co|No|Fig)\.)$",
    re.I)
# phpBB attachment furniture that rides along in the post body.
ATTACHMENT = re.compile(
    r"Attachment\s*:\s*File comment\s*:.*?(?=(?:[A-Z])|$)", re.S)


def restore_paragraphs(text: str) -> str:
    """Re-insert the paragraph breaks that textContent extraction dropped."""
    if "\n" in text:                      # harvest already preserved them
        return text
    text = ATTACHMENT.sub("", text)
    out, last = [], 0
    for m in PARA_BREAK.finditer(text):
        if ABBREV.search(text[max(0, m.start() - 6):m.start()]):
            continue
        out.append(text[last:m.start()].strip())
        last = m.start()
    out.append(text[last:].strip())
    return "\n\n".join(p for p in out if p)


# --- prompt/essay splitting -------------------------------------------------

# The GRE task instruction. Everything up to the end of the instruction block
# belongs to the prompt; the candidate's own writing starts after it.
INSTRUCTION = re.compile(
    r"(write a response in which you\b[^.]*\."
    r"|discuss the extent to which you (?:agree|disagree)\b[^.]*\."
    r"|explain how the (?:argument|answer)[^.]*\.)", re.I)
# GRE instructions come as a two-sentence block; this is the trailing sentence.
INSTRUCTION_TAIL = re.compile(
    r"^\s*(in developing and supporting your position\b[^.]*\."
    r"|be sure to (?:explain|address|discuss|consider)\b[^.]*\."
    r"|discuss what (?:questions|specific evidence)\b[^.]*\."
    r"|in your discussion be sure to\b[^.]*\.)", re.I)
# Explicit labels people type above the prompt ("Prompt:", "promt:", "Topic:").
LABEL = re.compile(
    r"^\s*(?:the\s+)?(?:prompt|promt|topic|question|essay topic|the argument|"
    r"argument|issue)\s*(?::-|:|-)\s*", re.I)
QUOTE_TAG = re.compile(r"^\s*Quote\s*:\s*", re.I)
# A prompt pasted as a leading quoted passage.
LEAD_QUOTE = re.compile(r'^\s*"([^"]{80,1800})"\s*', re.S)
# Posters very often label where their own writing starts. This is the most
# reliable boundary available, so it is tried before anything else.
ESSAY_START = re.compile(
    r"(?:^|\n)\s*(?:my\s+)?(?:answer|essay|response|attempt|my take|solution)"
    r"\s*(?::-|:|-)\s*\n?", re.I)


def split_prompt_essay(text: str):
    """Return (prompt, essay). Either may be empty."""
    t = text.strip()

    # 0. An explicit "Answer:" / "My essay:" divider written by the poster.
    m = ESSAY_START.search(t)
    if m and m.start() > 40:
        prompt, rest = t[:m.start()].strip(), t[m.end():].lstrip()
        if word_count(rest) >= 120:
            return LABEL.sub("", prompt).strip(), rest

    # 1. Verbatim GRE instruction -> cut right after the instruction block.
    m = INSTRUCTION.search(t)
    if m:
        prompt, rest = t[:m.end()], t[m.end():].lstrip()
        tail = INSTRUCTION_TAIL.match(rest)
        if tail:                       # pull the second instruction sentence
            prompt += " " + rest[:tail.end()].strip()
            rest = rest[tail.end():].lstrip()
        if word_count(rest) >= 100:
            return prompt.strip(), rest

    # 2. A "Prompt:" / "The argument:" style label.
    lab = LABEL.match(t)
    if lab:
        body = QUOTE_TAG.sub("", t[lab.end():].lstrip())
        # prompt runs to the blank line, else to the end of the first passage
        parts = body.split("\n\n", 1)
        if len(parts) == 2 and word_count(parts[1]) >= 100:
            return parts[0].strip(), parts[1].lstrip()
        q = LEAD_QUOTE.match(body)
        if q and word_count(body[q.end():]) >= 100:
            return q.group(1).strip(), body[q.end():].lstrip()

    # 3. Prompt pasted as a leading quoted passage.
    q = LEAD_QUOTE.match(t)
    if q and word_count(t[q.end():]) >= 100:
        return q.group(1).strip(), t[q.end():].lstrip()

    # 4. An Argument passage with no instruction line: the source document is
    #    quoted, so the closing quote is the boundary.
    if re.match(r"\s*the following\b", t, re.I):
        close = t.find('"', t.find('"') + 1) if '"' in t else -1
        if close > 80 and word_count(t[close + 1:]) >= 120:
            return t[:close + 1].strip(), t[close + 1:].lstrip()

    # 5. Paragraph break right after a short opening block that reads like a
    #    prompt rather than an essay opening.
    parts = t.split("\n\n", 1)
    if len(parts) == 2 and 15 <= word_count(parts[0]) <= 220 \
            and word_count(parts[1]) >= 150:
        return parts[0].strip(), parts[1].lstrip()

    # 6. Give up on the prompt rather than guess a split point.
    return "", t


# --- scores in replies ------------------------------------------------------

SCORE_RX = re.compile(
    r"\b([0-6](?:\.[05])?)\s*(?:/\s*6\b|out\s+of\s+6\b)", re.I)
# Anything produced by a tool rather than a person. The GMATAWA auto-grader
# report is the common case here and is recognisable by its fixed rubric
# headings even when the reply never names the tool -- several posters paste
# only the body of the report.
MACHINE = re.compile(
    r"(auto-?grader|autograder|gmatawa|e-?rater|assignment score|"
    r"you have written \d+ words|average sentence length|"
    r"automated (?:scor|grad)|essay grader|chatgpt|gpt-?4"
    r"|coherence and connectivity\s*:"
    r"|paragraph structure and formation\s*:"
    r"|vocabulary and word (?:expression|choice)\s*:"
    r"|this rating corresponds to"
    r"|i ran your essay through"
    r"|gre awa score\s*:\s*[0-6](?:\.\d)?\s*/\s*6)", re.I)
BOTS = {"VerbalBot", "GRE Bot", "AWA Bot"}


def find_score(replies):
    """Return (score, score_type, evidence) from the reply posts."""
    for body in replies:
        m = SCORE_RX.search(body)
        if not m:
            continue
        val = float(m.group(1))
        ctx = body[max(0, m.start() - 120):m.start() + 120].strip()
        ctx = re.sub(r"\s+", " ", ctx)
        if MACHINE.search(body):
            return val, "estimated", (
                "Automated grader output pasted into the thread "
                f"(machine score, NOT a human or official GRE rating): \"...{ctx}...\"")
        return val, "third_party_rated", (
            "Rated in the thread by another forum member: "
            f"\"...{ctx}...\". Community rating, not an official GRE score.")
    return None, "none", ""


# --- date -------------------------------------------------------------------

MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun",
     "jul", "aug", "sep", "oct", "nov", "dec"])}


DATES_FILE = os.path.join(CACHE_DIR, "prepclub_dates.txt")


def load_dates() -> dict:
    """thread id -> ISO date, harvested from the `span.post-date` of each page.

    Kept in a side file because the first pass of the browser harvest scraped
    the wrong element (the viewer's "last visit" timestamp) and stamped every
    thread with the crawl date.
    """
    out = {}
    if not os.path.exists(DATES_FILE):
        return out
    with open(DATES_FILE, encoding="utf-8") as f:
        for pair in f.read().strip().split(","):
            tid, _, ymd = pair.strip().partition(":")
            if len(ymd) == 8 and ymd.isdigit():
                out[tid] = f"{ymd[:4]}-{ymd[4:6]}-{ymd[6:]}"
    return out


def parse_date(s: str) -> str:
    m = re.match(r"\s*(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})", s or "")
    if not m:
        return ""
    mon = MONTHS.get(m.group(2).lower())
    if not mon:
        return ""
    iso = f"{m.group(3)}-{mon:02d}-{int(m.group(1)):02d}"
    # Guard against re-introducing the scrape bug: a "post date" of today (or
    # later) is the page furniture, not when the essay was written.
    return "" if iso >= time.strftime("%Y-%m-%d") else iso


# --- main -------------------------------------------------------------------

# Titles that are guides, announcements or question banks, not essays.
NOT_AN_ESSAY = re.compile(
    r"how to|tips |guide|strategy|template|all you need|masterclass|"
    r"question bank|vocab|resources|forum rules|percentile|study plan|"
    r"^poll|best gre books|sample essays|all topics", re.I)


def parse_all():
    with open(RAW, encoding="utf-8") as f:
        threads = json.load(f)

    dates = load_dates()
    print(f"  {len(dates)} post dates available from {os.path.basename(DATES_FILE)}")
    records, skipped = [], {"guide": 0, "short": 0, "no_body": 0}
    for th in threads:
        title = (th.get("t") or "").strip()
        if NOT_AN_ESSAY.search(title):
            skipped["guide"] += 1
            continue
        bodies = th.get("b") or []
        if not bodies:
            skipped["no_body"] += 1
            continue

        raw_body = clean_text(bodies[0])
        rebuilt = "\n" not in raw_body
        prompt, essay = split_prompt_essay(restore_paragraphs(raw_body))
        if word_count(essay) < 120:
            skipped["short"] += 1
            continue

        score, stype, sev = find_score([clean_text(b) for b in bodies[1:]])
        idm = re.search(r"-(\d+)\.html$", th.get("u", ""))
        date = dates.get(idm.group(1) if idm else "") or parse_date(th.get("d", ""))
        author = next((u for u in (th.get("us") or []) if u not in BOTS), "")
        url = th.get("u", "")

        if date and date > CUTOFF_AI:
            auth, why = "likely", (
                f"Posted {date} by forum member '{author}' asking the community "
                "to grade their own practice essay; after the public launch of "
                "ChatGPT, so LLM assistance cannot be excluded.")
        elif date:
            auth, why = "confirmed", (
                f"Posted {date} by forum member '{author}' asking the community "
                "to grade their own practice essay, before public generative-AI "
                "writing tools existed.")
        else:
            auth, why = "likely", (
                f"Practice essay posted for community feedback by forum member "
                f"'{author}'; posting date not recoverable from the page.")

        records.append(make_record(
            essay_id=make_essay_id("prepclub", url.rsplit("/", 1)[-1]),
            essay_text=essay,
            essay_type=classify_task(prompt, essay, title),
            prompt_text=prompt,
            prompt_category="user-pasted GRE pool topic (verified separately)",
            score=score if score is not None else "",
            score_type=stype,
            score_scale="0-6" if score is not None else "",
            human_authenticity=auth,
            exam_or_practice="practice",
            author_username=author,
            source_name="GRE Prep Club (MyPrepClub) AWA forum",
            source_url=url,
            publication_date=date,
            evidence_for_score=sev,
            evidence_for_human_authorship=why,
            notes="collected via the account holder's own logged-in browser "
                  "session; the domain refuses anonymous requests (HTTP 403)"
                  + ("; paragraph breaks reconstructed from block-join points "
                     "in the extracted text, not read from the original markup"
                     if rebuilt else ""),
        ))

    print(f"parsed {len(records)}, skipped {skipped}")
    save_stage("prepclub", records)


if __name__ == "__main__":
    parse_all()
