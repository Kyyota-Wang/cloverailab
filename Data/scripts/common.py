"""Shared helpers for the GRE human-essay collection pipeline."""
from __future__ import annotations

import hashlib
import json
import os
import random
import re
import sqlite3
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE_DIR = os.path.join(ROOT, "raw_cache")
OUT_DIR = os.path.join(ROOT, "out")
os.makedirs(CACHE_DIR, exist_ok=True)
os.makedirs(OUT_DIR, exist_ok=True)

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36"
)

# ---------------------------------------------------------------- HTTP cache


class HttpCache:
    """SQLite-backed page cache so crawls are restartable and polite."""

    def __init__(self, name: str, readonly: bool = False):
        self.path = os.path.join(CACHE_DIR, f"{name}.sqlite")
        self.conn = sqlite3.connect(self.path, check_same_thread=False,
                                    timeout=60)
        # A crawl often runs in one process while another parses the same
        # cache; WAL plus a busy timeout lets them coexist instead of raising
        # "database is locked".
        self.conn.execute("PRAGMA busy_timeout = 60000")
        if not readonly:
            self.conn.execute("PRAGMA journal_mode = WAL")
            self.conn.execute(
                "CREATE TABLE IF NOT EXISTS pages ("
                "url TEXT PRIMARY KEY, status INTEGER, fetched_at TEXT, body TEXT)"
            )
            self.conn.commit()

    def get(self, url: str):
        row = self.conn.execute(
            "SELECT status, body FROM pages WHERE url = ?", (url,)
        ).fetchone()
        return row

    def put(self, url: str, status: int, body: str):
        self.conn.execute(
            "INSERT OR REPLACE INTO pages VALUES (?,?,datetime('now'),?)",
            (url, status, body),
        )
        self.conn.commit()

    def count(self) -> int:
        return self.conn.execute("SELECT COUNT(*) FROM pages").fetchone()[0]

    def iter_ok(self):
        cur = self.conn.execute("SELECT url, body FROM pages WHERE status = 200")
        while True:
            rows = cur.fetchmany(50)
            if not rows:
                break
            yield from rows


def fetch_many(cache: HttpCache, urls, workers=8, delay=0.05, timeout=90,
               headers=None, progress_every=100, retry_failed=True, attempts=6):
    """Fetch urls into the cache with a modest thread pool.

    web.archive.org refuses a fraction of connections outright rather than
    queueing them, and those refusals come back in ~2s. Backing off hard on
    them (the obvious "be polite" reflex) collapses throughput by ~10x for no
    benefit, so retries are quick and numerous instead. Anything already
    cached with a 200 is skipped; earlier hard failures (-1) are retried.
    """
    todo = []
    for u in urls:
        row = cache.get(u)
        if row is None or (retry_failed and row[0] != 200):
            todo.append(u)
    print(f"  {len(urls)} urls, {len(urls) - len(todo)} usable in cache, "
          f"{len(todo)} to fetch", flush=True)
    sess_headers = {"User-Agent": UA}
    if headers:
        sess_headers.update(headers)
    done = 0

    def _one(url):
        s = requests.Session()
        s.headers.update(sess_headers)
        for attempt in range(attempts):
            try:
                r = s.get(url, timeout=timeout)
                if r.status_code in (429, 503, 502) and attempt < attempts - 1:
                    time.sleep(min(60, 5 * 2 ** attempt))   # real overload
                    continue
                return url, r.status_code, r.text
            except Exception:
                if attempt == attempts - 1:
                    return url, -1, ""
                time.sleep(1.5 + attempt)                   # refused connection
        return url, -1, ""

    # Work in small batches so results land in the cache continuously; a crawl
    # that is interrupted half-way keeps everything fetched so far.
    batch = max(workers * 8, 24)
    with ThreadPoolExecutor(max_workers=workers) as ex:
        for start in range(0, len(todo), batch):
            chunk = todo[start:start + batch]
            futs = []
            for u in chunk:
                futs.append(ex.submit(_one, u))
                time.sleep(delay)
            for f in as_completed(futs):
                url, status, body = f.result()
                cache.put(url, status, body)
                done += 1
                if done % progress_every == 0:
                    ok = cache.conn.execute(
                        "SELECT COUNT(*) FROM pages WHERE status=200").fetchone()[0]
                    print(f"  fetched {done}/{len(todo)} (cache 200s: {ok})",
                          flush=True)
    return cache


# ------------------------------------------------------------- text handling

_WS = re.compile(r"[ \t ]+")


def clean_text(s: str) -> str:
    if not s:
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = s.replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"')
    s = s.replace("–", "-").replace("—", "--")
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = _WS.sub(" ", s)
    s = re.sub(r"\n{3,}", "\n\n", s)
    lines = [ln.strip() for ln in s.split("\n")]
    return "\n".join(lines).strip()


def word_count(s: str) -> int:
    return len(re.findall(r"[A-Za-z0-9']+", s or ""))


def norm_key(s: str) -> str:
    """Aggressive normalisation used for exact-duplicate detection."""
    s = unicodedata.normalize("NFKD", (s or "").lower())
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())


def sha1(s: str) -> str:
    return hashlib.sha1(s.encode("utf-8", "ignore")).hexdigest()


def make_essay_id(prefix: str, slug: str, keep: int = 70) -> str:
    """Readable id that stays unique even when slugs share a long prefix."""
    clean = re.sub(r"[^a-z0-9]+", "_", slug.lower()).strip("_")
    return f"{prefix}_{clean[:keep]}_{sha1(slug)[:8]}"


def shingles(s: str, k: int = 5):
    toks = norm_key(s).split()
    if len(toks) < k:
        return {" ".join(toks)} if toks else set()
    return {" ".join(toks[i:i + k]) for i in range(len(toks) - k + 1)}


# Multipliers/offsets for the permutation trick below. Fixed so that a rebuild
# reproduces the same signatures.
_MERSENNE = (1 << 61) - 1
_PERMS = None


def _perms(num: int):
    global _PERMS
    if _PERMS is None or len(_PERMS) != num:
        rnd = random.Random(0x5EED)
        _PERMS = [(rnd.randrange(1, _MERSENNE), rnd.randrange(0, _MERSENNE))
                  for _ in range(num)]
    return _PERMS


def minhash(s: str, num: int = 96, k: int = 5):
    """Cheap MinHash signature for near-duplicate detection.

    Each shingle is hashed **once** and the `num` permutations are derived
    arithmetically from that single hash. Hashing every shingle once per
    permutation instead (the obvious way) re-hashes the string 96 times and
    dominates the whole build once the corpus passes a few thousand essays.
    """
    sh = shingles(s, k)
    if not sh:
        return tuple([0] * num)
    base = [hash(g) & 0xFFFFFFFFFFFFFFF for g in sh]
    sig = []
    for a, b in _perms(num):
        best = _MERSENNE
        for h in base:
            v = (a * h + b) % _MERSENNE
            if v < best:
                best = v
        sig.append(best & 0xFFFFFFFF)
    return tuple(sig)


def jaccard_est(a, b) -> float:
    if not a or not b:
        return 0.0
    return sum(1 for x, y in zip(a, b) if x == y) / len(a)


# --------------------------------------------------- issue vs argument task

# The two GRE tasks have fixed, distinctive instruction sets and openings, so
# classify from those rather than from whether the word "argument" happens to
# appear (it appears constantly inside Issue essays too).
_ARG_PROMPT = re.compile(
    # "The following is my essay..." is NOT an Argument passage, so the
    # opening must be followed by a document noun.
    r"(the following (?:appeared|was (?:published|taken)|is (?:a|an|part of|taken))\s+"
    r"(?:appeared\s+)?(?:in|as|from|a|an)?\s*"
    r"(?:memo|memorandum|letter|report|article|recommendation|editorial|"
    r"passage|excerpt|statement|advertisement|note|proposal|column|"
    r"newsletter|press release|part of)"
    r"|examine the stated and/or unstated assumptions"
    r"|what specific evidence is needed to evaluate"
    r"|questions would need to be answered in order to decide"
    r"|alternative explanations that could rival)", re.I)
_ISSUE_PROMPT = re.compile(
    r"(discuss the extent to which you agree or disagree"
    r"|discuss which view more closely aligns"
    r"|discuss your views on the policy"
    r"|address the most compelling reasons and/or examples"
    r"|describe specific circumstances in which adopting the recommendation)", re.I)
_ARG_BODY = re.compile(
    r"\b(unstated assumption|the author assumes|assumes that|the argument "
    r"(?:is|would be) (?:weak|strong|flaw)|logical fallac|unwarranted|"
    r"the memo|the recommendation is based|evidence (?:is|are) needed|"
    r"the conclusion (?:is|rests|depends))", re.I)
_ISSUE_BODY = re.compile(
    r"\b(i (?:strongly |largely |partially |whole?heartedly )?(?:agree|disagree)"
    r"|in my (?:opinion|view)|the statement (?:claims|asserts|suggests|implies)"
    r"|i concur|my (?:position|stance|standpoint)|the speaker (?:claims|asserts|"
    r"argues|contends)|the (?:claim|recommendation|policy) (?:that|is)"
    r"|to (?:a (?:large|great|certain) extent|some extent)"
    r"|the extent to which i agree)", re.I)


def is_gre_prompt(prompt: str) -> bool:
    """True when the text looks like an actual GRE task statement."""
    p = prompt or ""
    return bool(_ARG_PROMPT.search(p) or _ISSUE_PROMPT.search(p)
                or re.search(r"write a response in which you", p, re.I))


def issue_register_hits(essay: str) -> int:
    return len(_ISSUE_BODY.findall(essay or ""))


def argument_register_hits(essay: str) -> int:
    return len(_ARG_BODY.findall(essay or ""))


def classify_task(prompt: str, essay: str = "", title: str = "") -> str:
    """Return 'issue', 'argument' or 'unknown'."""
    p = prompt or ""
    if _ARG_PROMPT.search(p):
        return "argument"
    if _ISSUE_PROMPT.search(p):
        return "issue"
    t = (title or "").lower()
    if re.search(r"\bargument\b (?:task|essay|prompt)|\bargument (?:task|essay)\b", t):
        return "argument"
    if re.search(r"\bissue\b (?:task|essay|prompt)|\bissue (?:task|essay)\b", t):
        return "issue"
    body = essay or ""
    a, i = len(_ARG_BODY.findall(body)), len(_ISSUE_BODY.findall(body))
    if a > i:
        return "argument"
    if i > a:
        return "issue"
    return "unknown"


# ------------------------------------------------------------- record schema

FIELDS = [
    "essay_id",
    "essay_text",
    "essay_type",
    "prompt_text",
    "prompt_category",
    "score",
    "score_available",
    "score_type",
    "score_scale",
    "human_authenticity",
    "exam_or_practice",
    "author_username",
    "source_name",
    "source_url",
    "publication_date",
    "evidence_for_score",
    "evidence_for_human_authorship",
    "notes",
    "word_count",
    "collected_at",
]


def make_record(**kw) -> dict:
    rec = {f: kw.get(f, "") for f in FIELDS}
    rec["word_count"] = word_count(rec["essay_text"])
    rec["collected_at"] = time.strftime("%Y-%m-%d")
    if rec["score"] in ("", None):
        rec["score_available"] = False
        if not rec["score_type"]:
            rec["score_type"] = "none"
    else:
        rec["score_available"] = True
    return rec


def save_stage(name: str, records: list):
    path = os.path.join(OUT_DIR, f"stage_{name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=1)
    print(f"  wrote {len(records)} records -> {path}")
    return path


def load_stage(name: str) -> list:
    path = os.path.join(OUT_DIR, f"stage_{name}.json")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)
