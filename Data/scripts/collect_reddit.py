"""Collector 4 -- Reddit GRE communities (via the Arctic Shift / PullPush mirrors).

Reddit's own API is blocked from this environment, so posts are pulled from the
public Reddit data mirrors. Test takers routinely paste a full Issue or Argument
response into a self-post and ask for feedback; a subset also state the AWA
score they actually received ("got a 5.0 on AWA, here's the essay") -> those
become self_reported records.

Nothing here is an official score. Scores are only recorded when the poster
states a real GRE AWA result for *that* essay; anything vaguer stays scoreless.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (CACHE_DIR, classify_task, clean_text,  # noqa: E402
                    is_gre_prompt, issue_register_hits, make_record,
                    save_stage, word_count)

ARCTIC = "https://arctic-shift.photon-reddit.com/api/posts/search"
PULLPUSH = "https://api.pullpush.io/reddit/search/submission/"
RAW = os.path.join(CACHE_DIR, "reddit_posts.jsonl")

SUBREDDITS = ["GRE", "GREhelp", "gre_prep", "GREPreparation", "Gretests",
              "testprep", "gradadmissions", "GREPrep", "gretest",
              "gradschool", "ApplyingToCollege"]
QUERIES = [
    # essay-sharing genre
    "issue essay", "argument essay", "AWA essay", "analytical writing",
    "rate my essay", "grade my essay", "essay feedback", "awa feedback",
    "my issue task", "my argument task", "essay review", "awa score essay",
    "wrote this essay", "practice essay", "issue task", "argument task",
    "critique my essay", "review my essay", "rate my awa", "essay draft",
    "first essay attempt", "essay attempt", "analytical writing feedback",
    "essay help", "please rate", "how would you score this essay",
    # score-plus-essay genre (the only route to self_reported records)
    "got a 6 on awa", "got a 5.5 on awa", "got a 5 on awa",
    "scored 6 on awa", "essay that got me", "essay that scored",
    "this essay got", "awa 6.0 essay", "awa 5.5 essay", "6.0 awa essay",
    "here is the essay i wrote", "the essay i submitted",
]

# Distinctive invented place/company names from the official ETS Issue and
# Argument pools. The mirror searches post bodies, so querying these surfaces
# posts that contain an actual pool prompt -- far higher precision than
# generic words like "essay".
POOL_QUERIES = [
    "Mason City", "Monarch Books", "Nature's Way", "Palean baskets",
    "Omega University", "Movies Galore", "Happy Pancake House",
    "Quiot Manufacturing", "Groveton College", "Balmer Island",
    "Waymarsh", "Plainsville", "Centerville", "Dillton", "Mentia",
    "Sunnyside Towers", "Grandview Symphony", "Central Plaza",
    "West Meria", "Alta Manufacturing", "Buzzoff", "Panoply Industries",
    "Super Screen", "Climpson Industries", "Tertia", "Leeville",
    "Bayview High School", "Nosinia", "Adams Realty", "Canbury",
    "Deerhaven Acres", "Excello Food Market", "Fern Valley",
    "Jazz music club in Monroe", "Zeta computer", "Delany Salon",
    "Amburg", "Marlee", "Sanlee", "Humana University", "Gulf Shrimp",
]

QUERIES = QUERIES + POOL_QUERIES

CUTOFF_AI = datetime(2022, 11, 30, tzinfo=timezone.utc).timestamp()

# --- signals that a self-post actually contains a GRE AWA response ----------
PROMPT_MARKERS = re.compile(
    r"(write a response in which you|discuss the extent to which you agree|"
    r"the following appeared in a (memo|letter|report|article|memorandum)|"
    r"analyze an issue|analyze an argument|issue task|argument task|"
    r"examine the stated and/or unstated assumptions|"
    r"specific evidence is needed to evaluate)", re.I)
ESSAY_MARKERS = re.compile(
    r"(the author|the speaker|the argument|in conclusion|firstly|"
    r"to conclude|the statement|i agree|i disagree|the recommendation)", re.I)
GRE_CONTEXT = re.compile(
    r"\b(gre|awa|analytical writing|issue essay|argument essay)\b", re.I)

# --- self-reported score patterns -------------------------------------------
SCORE_PATTERNS = [
    re.compile(r"\b(?:got|scored|received|ended up with|earned)\s+(?:an?\s+)?"
               r"([0-6](?:\.[05])?)\s*(?:/\s*6)?\s*(?:on|in|for)?\s*"
               r"(?:the\s+)?(?:awa|aw|analytical writing|writing|essay)", re.I),
    re.compile(r"\b(?:awa|aw|analytical writing)\s*(?:score)?\s*[:=-]?\s*"
               r"([0-6](?:\.[05])?)\b", re.I),
    re.compile(r"\bthis essay (?:got|received|scored)\s*(?:an?\s+)?"
               r"([0-6](?:\.[05])?)", re.I),
    # "Princeton Review gave 2/6", "rated it 4/6", "scored 4.5/6"
    re.compile(r"\b(?:gave|rated|scored|graded)\s+(?:it|me|this|my essay)?\s*"
               r"(?:a\s+)?([0-6](?:\.[05])?)\s*/\s*6\b", re.I),
    re.compile(r"\b([0-6](?:\.[05])?)\s*/\s*6\b"),
]

# Who produced the number decides the score_type.
RATER_MACHINE = re.compile(
    r"(e-?rater|scoreitnow|score it now|mbacrystalball|crystal ball|"
    r"auto(?:mated)? (?:scor|grad)|essay grader|chatgpt|gpt-?4|claude|gemini|"
    r"ai (?:grader|scorer|tool)|gradesaver|princeton review('s)? (?:tool|scorer))",
    re.I)
RATER_OFFICIAL = re.compile(
    r"(official (?:score|report)|ets\b|actual (?:test|exam|score)|"
    r"real (?:test|exam|gre)|score report|on test day|my actual awa)", re.I)
RATER_TEACHER = re.compile(
    r"(my (?:tutor|teacher|instructor|coach)|gregmat|prep (?:instructor|tutor)|"
    r"a tutor|writing centre|writing center)", re.I)


# ------------------------------------------------------------------ download

def _get(url, params, tries=4):
    for i in range(tries):
        try:
            r = requests.get(url, params=params, timeout=120,
                             headers={"User-Agent": "gre-corpus-research/1.0"})
            if r.status_code == 200:
                return r.json()
            time.sleep(4 * (i + 1))
        except Exception:
            time.sleep(4 * (i + 1))
    return {}


def harvest():
    """Sweep every (subreddit, query) pair, walking backwards through time."""
    seen = set()
    if os.path.exists(RAW):
        with open(RAW, encoding="utf-8") as f:
            for line in f:
                try:
                    seen.add(json.loads(line)["id"])
                except Exception:
                    pass
    print(f"{len(seen)} posts already cached")

    out = open(RAW, "a", encoding="utf-8")
    added = 0
    for sub in SUBREDDITS:
        for q in QUERIES:
            before = None
            for _page in range(12):          # up to 1200 posts per (sub, query)
                params = {"subreddit": sub, "query": q, "limit": 100}
                if before:
                    params["before"] = int(before)
                data = (_get(ARCTIC, params) or {}).get("data") or []
                if not data:
                    break
                oldest = None
                new_here = 0
                for p in data:
                    cu = p.get("created_utc")
                    if cu and (oldest is None or cu < oldest):
                        oldest = cu
                    pid = p.get("id")
                    if not pid or pid in seen:
                        continue
                    seen.add(pid)
                    out.write(json.dumps({
                        "id": pid,
                        "subreddit": p.get("subreddit") or sub,
                        "author": p.get("author"),
                        "title": p.get("title"),
                        "selftext": p.get("selftext"),
                        "created_utc": cu,
                        "permalink": p.get("permalink"),
                        "flair": p.get("link_flair_text"),
                        "query": q,
                    }, ensure_ascii=False) + "\n")
                    new_here += 1
                    added += 1
                out.flush()
                print(f"  r/{sub} '{q}' page -> {len(data)} posts, {new_here} new "
                      f"(total new {added})", flush=True)
                if len(data) < 100 or oldest is None:
                    break
                before = oldest
                time.sleep(0.6)
    out.close()
    print(f"harvest done: {added} new posts, {len(seen)} total")


# ------------------------------------------------------- grader comments

COMMENTS_API = "https://arctic-shift.photon-reddit.com/api/comments/search"
RAW_COMMENTS = os.path.join(CACHE_DIR, "reddit_comments.jsonl")

# "I'd give this a 4.5", "solid 5", "this is a 3/6", "I'd rate it 4"
GRADER_PATTERNS = [
    re.compile(r"\b(?:i'?d|i would|i'll)\s+(?:give|rate|score|put)\s+"
               r"(?:this|it|your essay|you)?\s*(?:at|a|an)?\s*"
               r"([0-6](?:\.[05])?)\b", re.I),
    re.compile(r"\bthis (?:is|reads like|looks like)\s+(?:a|an)?\s*"
               r"(?:solid|strong|weak|clear)?\s*([0-6](?:\.[05])?)\b", re.I),
    re.compile(r"\b(?:solid|strong|clear|maybe|probably|around|about)\s+"
               r"(?:a\s+)?([0-6](?:\.[05])?)\s*(?:/\s*6)?\b", re.I),
    re.compile(r"\b([0-6](?:\.[05])?)\s*/\s*6\b"),
    re.compile(r"\bscore\s*[:=]\s*([0-6](?:\.[05])?)\b", re.I),
]


def harvest_comments():
    """Pull the comment threads of every post that yielded an essay."""
    have = set()
    if os.path.exists(RAW_COMMENTS):
        with open(RAW_COMMENTS, encoding="utf-8") as f:
            for line in f:
                try:
                    have.add(json.loads(line)["link"])
                except Exception:
                    pass
    stage = os.path.join(os.path.dirname(RAW), "..", "out", "stage_reddit.json")
    stage = os.path.normpath(stage)
    if not os.path.exists(stage):
        print("run --parse first so we know which posts contain essays")
        return
    with open(stage, encoding="utf-8") as f:
        posts = [r["essay_id"].replace("reddit_", "") for r in json.load(f)]
    todo = [p for p in posts if p not in have]
    print(f"{len(posts)} essay posts, {len(todo)} comment threads to fetch")

    out = open(RAW_COMMENTS, "a", encoding="utf-8")
    for i, pid in enumerate(todo, 1):
        data = (_get(COMMENTS_API, {"link_id": f"t3_{pid}", "limit": 100})
                or {}).get("data") or []
        out.write(json.dumps({"link": pid, "comments": [
            {"author": c.get("author"), "body": c.get("body"),
             "score": c.get("score"), "created_utc": c.get("created_utc")}
            for c in data]}, ensure_ascii=False) + "\n")
        out.flush()
        if i % 25 == 0:
            print(f"  {i}/{len(todo)}", flush=True)
        time.sleep(0.35)
    out.close()
    print("comment harvest done")


def load_grader_scores():
    """Map post id -> (score, evidence) taken from a *replier*, not the OP."""
    if not os.path.exists(RAW_COMMENTS):
        return {}
    found = {}
    for line in open(RAW_COMMENTS, encoding="utf-8"):
        try:
            row = json.loads(line)
        except Exception:
            continue
        best = None
        for c in row.get("comments") or []:
            body = clean_text(c.get("body") or "")
            if not body or body in ("[removed]", "[deleted]"):
                continue
            # ignore 3-digit total scores and section scores
            if re.search(r"\b(1[2-7]\d|q\s*1[4-7]\d|v\s*1[4-7]\d)\b", body, re.I):
                continue
            for rx in GRADER_PATTERNS:
                m = rx.search(body)
                if not m:
                    continue
                try:
                    v = float(m.group(1))
                except ValueError:
                    continue
                if not 0 <= v <= 6:
                    continue
                ctx = body[max(0, m.start() - 120):m.end() + 120]
                cand = (c.get("score") or 0, v, c.get("author"), ctx)
                if best is None or cand[0] > best[0]:
                    best = cand
                break
        if best:
            _, v, author, ctx = best
            found[row["link"]] = (v, (
                f"Rated in the comment thread by another redditor (u/{author}): "
                f"\"...{ctx}...\". Community rating, not an official GRE score."))
    return found


# -------------------------------------------------------------------- parsing

BOILER = re.compile(
    r"^(edit\s*:|update\s*:|tl;?dr|thanks in advance|any feedback|please rate)",
    re.I)

# Sentences that belong to the *task instructions*, not to the response. GRE
# uses a fixed set of instruction sets, so posters paste them verbatim above
# their essay and a naive split leaves the tail of one glued to the essay.
INSTRUCTION_SENT = re.compile(
    r"^(write a response in which you\b"
    r"|in developing and supporting your position\b"
    r"|be sure to explain\b"
    r"|be sure to (?:address|discuss|consider)\b"
    r"|discuss what (?:questions|specific evidence)\b"
    r"|examine the stated and/or unstated assumptions\b"
    r"|discuss the extent to which you (?:agree|disagree)\b"
    r"|you should (?:consider|address)\b"
    r"|explain how the answers to these questions\b"
    r"|describe specific circumstances in which\b"
    r"|(?:be sure to )?explain how these (?:considerations|consequences|examples) shape\b"
    r"|a response to any other .{0,40}will receive a score of zero\b"
    r")", re.I)

# Bare labels posters put between the prompt and the essay.
LABEL_ONLY = re.compile(
    r"^(essay|my essay|response|my response|essay response|my answer|answer|"
    r"here(?:'s| is) (?:my|the) (?:essay|response|attempt)|attempt|"
    r"issue essay|argument essay|prompt|instructions?)\s*[:.\-]?\s*$", re.I)

# Trailing chatter posters add after the essay.
TRAILER = re.compile(
    r"^(thanks?\b|thank you\b|any (?:feedback|suggestions|help)|please (?:rate|review|"
    r"grade|be honest)|i(?:'d| would) (?:really )?appreciate|feedback (?:is )?"
    r"(?:welcome|appreciated)|be brutal|rate it out of|how (?:would|much) would you|"
    r"p\.?s\.?\b|edit\s*:|update\s*:)", re.I)

ENTITIES = {"&#x200b;": "", "&amp;": "&", "&lt;": "<", "&gt;": ">",
            "&nbsp;": " ", "&quot;": '"', "&#39;": "'"}


def demarkdown(text: str) -> str:
    """Reddit selftext is markdown; strip the syntax but keep the prose."""
    low = text
    for k, v in ENTITIES.items():
        low = re.sub(re.escape(k), v, low, flags=re.I)
    low = re.sub(r"^\s*>+\s?", "", low, flags=re.M)        # block quotes
    low = re.sub(r"\*\*|__|\*|_|`", "", low)               # emphasis / code
    low = re.sub(r"^#{1,6}\s*", "", low, flags=re.M)       # headings
    low = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", low)     # links
    low = re.sub(r"^\s*[-*_]{3,}\s*$", "", low, flags=re.M)  # rules
    low = re.sub(r"​|﻿", "", low)
    return low


def _sentences(block: str):
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", block) if s.strip()]


JUNK_LINE = re.compile(r"^[^A-Za-z]*$")
WORDCOUNT_NOTE = re.compile(
    r"^(essay|my essay|response)?\s*[:\-]?\s*\(?\s*\d{2,4}\s*words?\b.*$", re.I)
# A pool passage pasted at the top of the essay with no instruction line.
EMBEDDED_PROMPT = re.compile(
    r"^\s*(?:the following (?:is|appeared)|in surveys|the following was)\b",
    re.I)


def strip_junk_head(essay: str) -> str:
    lines = essay.split("\n")
    while lines:
        first = lines[0].strip()
        if not first or JUNK_LINE.match(first) or WORDCOUNT_NOTE.match(first):
            lines.pop(0)
            continue
        break
    return "\n".join(lines)


# A short opening paragraph addressed to the subreddit rather than to the
# essay's reader ("Hi all, I retake in 5 days, could this get a 3?").
PREAMBLE = re.compile(
    r"\b(hi|hello|hey|guys|everyone|folks|please|kindly|thanks|thank you|"
    r"feedback|critique|rate|review|grade|retake|i(?:'m| am) (?:new|struggling)|"
    r"first (?:time|attempt)|any (?:help|advice|suggestions)|my (?:first|second) "
    r"(?:essay|attempt)|could (?:this|someone)|would (?:appreciate|love))\b", re.I)


def strip_preamble(essay: str) -> str:
    """Drop the poster's note-to-the-subreddit that precedes the essay."""
    paras = [p for p in essay.split("\n") if p.strip()]
    while paras:
        head = paras[0]
        wc = word_count(head)
        if wc < 80 and len(PREAMBLE.findall(head)) >= 2:
            rest = "\n".join(paras[1:])
            if word_count(rest) >= 250:
                paras = paras[1:]
                continue
        break
    return "\n".join(paras)


PROMPT_HEADER = re.compile(
    r"^\s*(prompt|topic|question|claim|essay prompt|issue|argument)\s*[:\-]", re.I)


def pull_labelled_prompt(essay: str):
    """Handle "Prompt:" / "Claim: ... Reason: ..." headers with no
    "Write a response" instruction line."""
    lines = [ln for ln in essay.split("\n") if ln.strip()]
    if not lines or not PROMPT_HEADER.match(lines[0]):
        return "", essay
    # the prompt runs until the first substantial paragraph (the essay body)
    for i in range(1, min(len(lines), 8)):
        if word_count(lines[i]) >= 60 and not PROMPT_HEADER.match(lines[i]):
            head, rest = "\n".join(lines[:i]), "\n".join(lines[i:])
            if word_count(rest) >= 250 and word_count(head) <= 400:
                return head.strip(), rest.strip()
            break
    return "", essay


def pull_embedded_prompt(essay: str):
    """If the essay still opens with the pool passage, split it back out."""
    labelled, essay = pull_labelled_prompt(essay)
    if labelled:
        return labelled, essay
    if not EMBEDDED_PROMPT.match(essay):
        return "", essay
    m = re.search(r'"\s*(?:\n|$)', essay)
    if not m:
        return "", essay
    head, rest = essay[:m.end()], essay[m.end():]
    if word_count(rest) < 250 or word_count(head) > 500:
        return "", essay
    return head.strip(), rest.strip()


def strip_leading_instructions(essay: str):
    """Move any task-instruction text stranded at the top of the essay back
    into the prompt. Returns (moved_text, cleaned_essay)."""
    moved = []
    changed = True
    while changed:
        changed = False
        essay = essay.lstrip("\n \t")
        if not essay:
            break
        # whole leading line is a bare label
        first_line, _, rest_lines = essay.partition("\n")
        if LABEL_ONLY.match(first_line.strip()):
            essay = rest_lines
            changed = True
            continue
        # inline label, e.g. "My response: I disagree with ..."
        # "My response ~ 500 words:", "Essay (timed):", "My answer -"
        inline = re.match(
            r"\s*(?:my |the )?(?:essay|response|answer|attempt|"
            r"essay response)\b[^:\n]{0,40}[:\-]\s+", essay, re.I)
        if inline:
            essay = essay[inline.end():]
            changed = True
            continue
        sents = _sentences(essay.split("\n\n")[0])
        if sents and INSTRUCTION_SENT.match(sents[0]):
            moved.append(sents[0])
            essay = essay[essay.find(sents[0]) + len(sents[0]):]
            changed = True
    return " ".join(moved), essay.lstrip("\n \t")


def strip_trailer(essay: str) -> str:
    paras = essay.split("\n")
    while paras:
        last = paras[-1].strip()
        if not last or (word_count(last) < 45 and TRAILER.match(last)):
            paras.pop()
            continue
        break
    return "\n".join(paras)


# An AWA response keeps referring back to the thing it is analysing.
ANALYTIC_NOUNS = re.compile(
    r"\b(the author|the speaker|the argument|the statement|the claim|"
    r"the recommendation|the assumption|the conclusion|the memo|the prediction|"
    r"the advice|the evidence)\b", re.I)
# Chatter that marks a score report / study-plan / discussion post instead.
META_MARKERS = re.compile(
    r"\b(this subreddit|r/gre\b|gregmat|magoosh|manhattan prep|ttp\b|"
    r"my (?:quant|verbal) score|took the gre|test day|study plan|"
    r"practice test|powerprep|mock test|retake|application deadline|"
    r"i scored \d{3}|\b1[45678]\d\s*[qv]\b|\bq\s*1[456]\d\b)", re.I)


def looks_like_essay(prompt: str, text: str, relaxed_meta: bool = False) -> bool:
    """Decide whether a self-post body is an AWA response.

    Requiring "the author / the argument"-style nouns (the obvious test) turns
    out to be biased: Argument responses are full of them and Issue responses
    are not, which silently discarded ~300 Issue essays. So weigh several
    independent signals instead, and let a verbatim GRE prompt carry a post on
    its own. `relaxed_meta` applies to posts that state a real AWA score --
    those always mention test-day details, and they are the only route to
    self-reported records.
    """
    if word_count(text) < 250:
        return False
    if not ESSAY_MARKERS.search(text):
        return False
    # Essays are prose: require several long paragraphs, few list bullets.
    paras = [p for p in text.split("\n") if word_count(p) > 40]
    if len(paras) < 3:
        return False
    if len(re.findall(r"^\s*[-*\d]+[.)]\s", text, re.M)) > 4:
        return False

    evidence = 0
    if is_gre_prompt(prompt):
        evidence += 2                                    # verbatim GRE task
    if len(ANALYTIC_NOUNS.findall(text)) >= 3:
        evidence += 1                                    # Argument register
    if issue_register_hits(text) >= 2:
        evidence += 1                                    # Issue register
    if evidence == 0:
        return False

    meta = len(META_MARKERS.findall(text))
    if relaxed_meta:
        return meta <= 3 or evidence >= 2
    if meta >= 3:
        return False
    return not (meta >= 1 and evidence < 2)


def split_prompt_and_essay(text: str):
    """Posts usually paste the prompt first, then the response.

    The cut is made after the *whole* instruction block, not after its first
    sentence: GRE instruction sets are two sentences long and a naive split
    leaves "In developing and supporting your position..." heading the essay.
    """
    text = demarkdown(text)
    m = PROMPT_MARKERS.search(text)
    if not m:
        # No instruction line, but Argument posts often open with the pool
        # passage in quotes; treat that opening quotation as the prompt.
        q = re.match(r'\s*"([^"]{200,2200})"\s*', text)
        if q:
            rest = text[q.end():]
            if word_count(rest) >= 250:
                rest = strip_junk_head(strip_leading_instructions(rest)[1])
                return clean_text(q.group(0)), clean_text(strip_trailer(rest))
        body = strip_preamble(strip_junk_head(text))
        emb, body = pull_embedded_prompt(body)
        return clean_text(emb), clean_text(strip_trailer(body))

    tail = text[m.start():]
    instr = re.search(r"(write a response in which you[^\n]*?\.)(\s|$)",
                      tail, re.I | re.S)
    if instr:
        cut = m.start() + instr.end()
    else:
        para_end = text.find("\n\n", m.end())
        if para_end == -1:
            return "", clean_text(strip_trailer(text))
        cut = para_end
    prompt, essay = text[:cut], text[cut:]

    essay = strip_junk_head(essay)
    stranded, essay = strip_leading_instructions(essay)
    if stranded:
        prompt = prompt.rstrip() + " " + stranded
    essay = strip_preamble(strip_junk_head(essay))
    embedded, essay = pull_embedded_prompt(essay)
    if embedded:
        prompt = (prompt.rstrip() + "\n" + embedded).strip()
    essay = strip_trailer(essay)

    if word_count(essay) < 200:
        return "", clean_text(strip_trailer(text))
    return clean_text(prompt), clean_text(essay)


def find_score(title: str, body: str):
    """Return (score, score_type, evidence) or (None, '', '')."""
    for src, label in ((title, "post title"), (body, "post body")):
        for rx in SCORE_PATTERNS:
            m = rx.search(src or "")
            if not m:
                continue
            try:
                v = float(m.group(1))
            except ValueError:
                continue
            if not 0 <= v <= 6:
                continue
            ctx = clean_text(src[max(0, m.start() - 140):m.end() + 100])
            if RATER_MACHINE.search(ctx):
                st, who = "estimated", "an automated essay-scoring tool"
            elif RATER_OFFICIAL.search(ctx):
                st, who = "self_reported", "the poster's official GRE score report"
            elif RATER_TEACHER.search(ctx):
                st, who = "teacher_rated", "a tutor/instructor"
            else:
                st, who = "third_party_rated", "an unspecified rater"
            return v, st, (f"Stated in the {label}; attributed to {who}: "
                           f"\"...{ctx}...\"")
    return None, "", ""


def parse_all():
    if not os.path.exists(RAW):
        print("no harvested posts; run --harvest first")
        return
    grader = load_grader_scores()
    records, seen_ids = [], set()
    total = 0
    with open(RAW, encoding="utf-8") as f:
        for line in f:
            total += 1
            p = json.loads(line)
            if p["id"] in seen_ids:
                continue
            body = clean_text(p.get("selftext") or "")
            title = clean_text(p.get("title") or "")
            if body in ("[removed]", "[deleted]", ""):
                continue
            if not GRE_CONTEXT.search(title + " " + body):
                continue
            score, score_type, score_evid = find_score(title, body)
            if score is None and p["id"] in grader:
                score, score_evid = grader[p["id"]]
                score_type = "third_party_rated"
            prompt, essay = split_prompt_and_essay(body)
            if not looks_like_essay(prompt, essay, relaxed_meta=score is not None):
                continue
            seen_ids.add(p["id"])

            cu = p.get("created_utc") or 0
            date = (datetime.fromtimestamp(cu, tz=timezone.utc).strftime("%Y-%m-%d")
                    if cu else "")

            if cu and cu < CUTOFF_AI:
                auth = "confirmed"
                auth_note = (f"Reddit self-post by u/{p.get('author')} on {date}, "
                             "before public generative-AI writing tools existed; "
                             "posted asking for human feedback on their own work.")
            else:
                auth = "likely"
                auth_note = (f"Reddit self-post by u/{p.get('author')} on {date} "
                             "asking the community to critique their own practice "
                             "essay. Posted after ChatGPT's launch, so LLM "
                             "assistance cannot be fully excluded.")

            etype = classify_task(prompt, essay, title)

            records.append(make_record(
                essay_id=f"reddit_{p['id']}",
                essay_text=essay,
                essay_type=etype,
                prompt_text=prompt,
                prompt_category="user-pasted GRE prompt" if prompt else "not stated",
                score=score if score is not None else "",
                score_type=score_type if score is not None else "none",
                score_scale="0-6" if score is not None else "",
                human_authenticity=auth,
                exam_or_practice=("real_exam_reported" if score is not None
                                  and re.search(r"\b(official|actual|real) (test|exam|score)",
                                                body, re.I) else "practice"),
                author_username=f"u/{p.get('author')}",
                source_name=f"Reddit r/{p.get('subreddit')}",
                source_url="https://www.reddit.com" + (p.get("permalink") or ""),
                publication_date=date,
                evidence_for_score=score_evid,
                evidence_for_human_authorship=auth_note,
                notes=f"Post title: {title[:200]}"
                      + (f" | flair: {p.get('flair')}" if p.get("flair") else ""),
            ))
    print(f"scanned {total} posts -> {len(records)} essays")
    save_stage("reddit", records)


def main():
    args = sys.argv[1:]
    if "--harvest" in args:
        harvest()
    if "--comments" in args:
        harvest_comments()
    if "--parse" in args or not args:
        parse_all()


if __name__ == "__main__":
    main()
