"""Collector 2 -- testbig.com GRE Issue/Argument practice essays (via Wayback).

testbig.com ran a long-lived community where registered users pasted their own
GRE AWA practice essays for feedback. The live site is currently down ("Site
Maintenance"), so everything here is pulled from the Internet Archive.

Scores: testbig shows (a) a 1-10 community star rating and (b) an automated
"e-grader" score out of 6 posted as a comment by the bot user `e-grader`.
Neither is a real GRE score. The e-grader value is recorded with
score_type='estimated' and the community rating is kept in notes only.

Human authenticity: essays are attributed to named registered accounts, carry
posting dates (the bulk are 2011-2019, i.e. pre-LLM), and are full of the
non-native learner errors that a language model does not produce. Anything
posted after 2022-11-30 (ChatGPT launch) is downgraded to 'likely'/'uncertain'.

Usage:
    python collect_testbig.py --urls          # refresh URL list from Wayback CDX
    python collect_testbig.py --fetch [N]     # download pages into the cache
    python collect_testbig.py --parse         # build stage_testbig.json
"""
from __future__ import annotations

import os
import random
import re
import sys

import requests
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (CACHE_DIR, HttpCache, clean_text, fetch_many,  # noqa: E402
                    make_essay_id, make_record, save_stage, word_count)

CATEGORIES = [
    "gmatgre-issue-task-essays",
    "gmatgre-argument-task-essays",
    "gmatgre-essays",
]
URL_LIST = os.path.join(CACHE_DIR, "testbig_urls.tsv")
CACHE = "testbig"

CUTOFF_AI = "2022-11-30"  # ChatGPT public launch


# ------------------------------------------------------------------ url list

def build_url_list():
    rows = {}
    for cat in CATEGORIES:
        api = ("http://web.archive.org/cdx/search/cdx"
               f"?url=testbig.com/{cat}*&output=text&fl=original,timestamp"
               "&collapse=urlkey&filter=statuscode:200")
        print("CDX:", cat)
        r = requests.get(api, timeout=180)
        for line in r.text.splitlines():
            parts = line.split()
            if len(parts) != 2:
                continue
            url, ts = parts
            if "?" in url or "#" in url:
                continue
            path = url.split("testbig.com", 1)[-1].lstrip(":80").lstrip("/")
            # keep only /<category>/<slug> detail pages, not listing pages
            segs = [s for s in path.split("/") if s]
            if len(segs) != 2 or segs[0] not in CATEGORIES:
                continue
            canon = "https://www.testbig.com/" + "/".join(segs)
            # keep the newest snapshot per essay
            if canon not in rows or ts > rows[canon]:
                rows[canon] = ts
    with open(URL_LIST, "w", encoding="utf-8") as f:
        for u, ts in sorted(rows.items()):
            f.write(f"{u}\t{ts}\n")
    print(f"{len(rows)} essay URLs -> {URL_LIST}")


def load_url_list():
    """The list is deliberately shuffled, not left in URL order.

    web.archive.org rate-limits hard, so a run is likely to cover only part of
    the list. In URL order that part would be all Argument-task essays (they
    sort before Issue); shuffling with a fixed seed makes any prefix a
    representative sample of both tasks and of all topics, and keeps the crawl
    resumable in the same order across runs.
    """
    out = []
    with open(URL_LIST, encoding="utf-8") as f:
        for line in f:
            u, ts = line.rstrip("\n").split("\t")
            out.append((u, ts))
    random.Random(20240808).shuffle(out)
    return out


def wb(url: str, ts: str) -> str:
    return f"https://web.archive.org/web/{ts}id_/{url}"


# -------------------------------------------------------------------- parsing

DATE_RX = re.compile(
    r"Submitted by\s+(.+?)\s+on\s+(.+?)\s*(?:-\s*\d{1,2}:\d{2})?$", re.I)
DATE_RX2 = re.compile(r"By\s+(\S+)\s*-\s*Posted on\s+(.+?)$", re.I)
# The bot reports its score in two different layouts depending on the site
# version: "Scores by essay e-grader: 4.0 Out of 6" and "Final score: 5.0 out of 6".
EGRADER_RX = re.compile(
    r"(?:Scores?\s+by\s+essay\s+e-?grader|Final\s+score)\s*:?\s*"
    r"([0-9](?:\.[05])?)\s*out\s+of\s+6", re.I)
RATES_RX = re.compile(r"Rates?\s*:\s*([\d.]+)\s*out of 100", re.I)
STAR_RX = re.compile(r"Average:\s*([\d.]+)")
# testbig posts the machine evaluation under bot accounts whose names vary
# ("e-grader", "essayE-rater", ...); never record one as the essay author.
BOT_AUTHOR = re.compile(r"e-?\s?(grader|rater)", re.I)

MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august",
     "september", "october", "november", "december"])}


def parse_date(s: str) -> str:
    s = s.strip()
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", s)          # 09/14/2019
    if m:
        return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    m = re.search(r"(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", s)     # 07 March 2014
    if m and m.group(2).lower() in MONTHS:
        return f"{m.group(3)}-{MONTHS[m.group(2).lower()]:02d}-{int(m.group(1)):02d}"
    m = re.search(r"([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})", s)   # March 7, 2014
    if m and m.group(1).lower() in MONTHS:
        return f"{m.group(3)}-{MONTHS[m.group(1).lower()]:02d}-{int(m.group(2)):02d}"
    return ""


def _node(soup):
    return (soup.select_one("article.node--essay")
            or soup.select_one("div.node")
            or soup.select_one(".l-content")
            or soup)


def extract_prompt(soup) -> str:
    # newer template
    for sel in (".field--name-field-essaytitle .field__item",
                ".field-field-essaytitle .field-item",
                ".field-field-essaytitle .field-items"):
        el = soup.select_one(sel)
        if el:
            t = clean_text(el.get_text(" ", strip=True))
            if len(t) > 40:
                return t
    lab = soup.find(string=re.compile(r"^\s*Essay topic\s*:?\s*$", re.I))
    if lab:
        sib = lab.parent.find_next_sibling()
        if sib:
            t = clean_text(sib.get_text(" ", strip=True))
            if len(t) > 40:
                return t
    el = soup.select_one(".hidetitle")
    if el:
        t = clean_text(el.get_text(" ", strip=True))
        if len(t) > 40:
            return t
    for h in soup.select("h1"):
        t = clean_text(h.get_text(" ", strip=True))
        if len(t) > 40 and "TOEFL IELTS" not in t:
            return t
    return ""


STOP_MARKERS = re.compile(
    r"^(Average|Select rating|Cancel rating|Give it|Login|or\s*$|register|"
    r"Facebook|Google Plus|Send by email|Source & Links|Tags|Essay Categories|"
    r"Votes:|Comments|More essays by this user)", re.I)


def extract_body(soup) -> str:
    node = _node(soup)
    content = (node.select_one(".node__content") or node.select_one("div.content")
               or node)
    work = BeautifulSoup(str(content), "lxml")
    # strip prompt, rating widget, comments, links, nested views
    for sel in (".field--name-field-essaytitle", ".field-field-essaytitle",
                ".field--name-field-vote", ".field-field-vote",
                ".fivestar-widget", "form", ".links", ".node__links",
                ".comment", ".comment-wrapper", ".view", ".block",
                "script", "style", ".field--name-taxonomy-vocabulary-1",
                ".field-type-taxonomy-term-reference", ".average-rating",
                ".fivestar-summary"):
        for el in work.select(sel):
            el.decompose()
    # prefer explicit paragraphs
    paras = [clean_text(p.get_text(" ", strip=True)) for p in work.find_all("p")]
    paras = [p for p in paras if p and not STOP_MARKERS.match(p)]
    if sum(word_count(p) for p in paras) >= 80:
        return "\n\n".join(paras)
    # fall back to whole-block text, cut at the rating widget
    txt = clean_text(work.get_text("\n", strip=True))
    lines, keep = txt.split("\n"), []
    for ln in lines:
        if STOP_MARKERS.match(ln):
            break
        keep.append(ln)
    return clean_text("\n".join(keep))


def extract_meta(soup):
    author, date = "", ""
    for el in soup.select(".submitted, .node__submitted, .meta"):
        t = clean_text(el.get_text(" ", strip=True))
        m = DATE_RX.search(t) or DATE_RX2.search(t)
        if m:
            cand = m.group(1).strip()
            if not BOT_AUTHOR.search(cand):
                author, date = cand, parse_date(m.group(2))
                break
    if not author:
        t = clean_text(soup.get_text(" ", strip=True))
        m = DATE_RX.search(t) or DATE_RX2.search(t)
        if m and not BOT_AUTHOR.search(m.group(1)):
            author, date = m.group(1).strip(), parse_date(m.group(2))
    return author, date


def extract_scores(soup):
    full = soup.get_text("\n", strip=True)
    eg = EGRADER_RX.search(full)
    rates = RATES_RX.search(full)
    star = STAR_RX.search(full)
    return (float(eg.group(1)) if eg else None,
            rates.group(1) if rates else "",
            star.group(1) if star else "")


def parse_all():
    cache = HttpCache(CACHE, readonly=True)
    ts_by_url = dict(load_url_list())
    records, skipped = [], 0
    for wburl, body in cache.iter_ok():
        m = re.match(r"https://web\.archive\.org/web/(\d+)id_/(.+)$", wburl)
        if not m:
            continue
        ts, orig = m.group(1), m.group(2)
        soup = BeautifulSoup(body, "lxml")
        prompt = extract_prompt(soup)
        essay = extract_body(soup)
        if word_count(essay) < 120:
            skipped += 1
            continue
        author, date = extract_meta(soup)
        eg, rates, star = extract_scores(soup)

        slug_cat = orig.split("testbig.com/")[-1].split("/")[0]
        etype = ("issue" if "issue" in slug_cat else
                 "argument" if "argument" in slug_cat else "unknown")
        if etype == "unknown":
            low = prompt.lower()
            etype = "argument" if ("the following" in low[:120] or
                                   "appeared in" in low[:200]) else "issue"

        if date and date > CUTOFF_AI:
            auth, auth_note = "uncertain", (
                f"Posted {date}, after the public launch of ChatGPT; "
                "LLM authorship cannot be excluded.")
        elif date:
            auth, auth_note = "confirmed", (
                f"Posted {date} by registered community member '{author}', "
                "years before public generative-AI writing tools existed.")
        else:
            auth, auth_note = "likely", (
                "Community-submitted practice essay attributed to a registered "
                "user account; posting date not recoverable from the snapshot.")

        notes = []
        if rates:
            notes.append(f"testbig e-grader 'Rates': {rates}/100")
        if star:
            notes.append(f"community star rating: {star}/10")
        if "(Amended)" in prompt or "amended" in orig.lower():
            notes.append("Marked '(Amended)' on testbig: text may contain inline "
                         "tutor corrections mixed into the original wording.")

        records.append(make_record(
            # Slugs differ only in a trailing -1/-2, which a blind truncation
            # would cut off and collide on, so keep a hash of the full slug.
            essay_id=make_essay_id("testbig", orig.split("testbig.com/")[-1]),
            essay_text=essay,
            essay_type=etype,
            prompt_text=prompt,
            prompt_category="user-pasted GRE pool topic (verified separately)",
            score=eg if eg is not None else "",
            score_type="estimated" if eg is not None else "none",
            score_scale="0-6" if eg is not None else "",
            human_authenticity=auth,
            exam_or_practice="practice",
            author_username=author,
            source_name="testbig.com (GMAT/GRE essay community) via Internet Archive",
            source_url=orig,
            publication_date=date,
            evidence_for_score=(
                "Automated 'e-grader' machine score posted on the page "
                "('Scores by essay e-grader: X Out of 6'). NOT a human or official "
                "GRE rating." if eg is not None else ""),
            evidence_for_human_authorship=auth_note,
            notes="; ".join(notes) + f" | archive snapshot: "
                                     f"https://web.archive.org/web/{ts}/{orig}",
        ))
    print(f"parsed {len(records)}, skipped {skipped} (too short / not an essay)")
    save_stage("testbig", records)


# ---------------------------------------------------------------------- main

def main():
    args = sys.argv[1:]
    if "--urls" in args or not os.path.exists(URL_LIST):
        build_url_list()
    if "--fetch" in args:
        i = args.index("--fetch")
        limit = int(args[i + 1]) if len(args) > i + 1 and args[i + 1].isdigit() else None
        pairs = load_url_list()
        if limit:
            pairs = pairs[:limit]
        cache = HttpCache(CACHE)
        # Steady trickle: the archive caps anonymous replay traffic at roughly
        # 15 pages/min, and pushing past it just earns refusals.
        fetch_many(cache, [wb(u, t) for u, t in pairs], workers=4,
                   delay=0.8, attempts=3, progress_every=25)
        print("cache size:", cache.count())
    if "--parse" in args:
        parse_all()


if __name__ == "__main__":
    main()
