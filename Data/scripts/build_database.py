"""Merge every collector stage into the final corpus.

Steps: load stages -> quality filter -> exact dedup -> near-dup dedup
-> priority/type labelling -> gre_human_essays.{csv,json} + reports.

Duplicate policy: GRE sites copy each other relentlessly, so a text that
appears in several places is kept exactly once, under whichever source has the
strongest provenance (official ETS > teacher-rated > self-reported > ...).
The URLs of the discarded copies are preserved in `duplicate_of_sources` so the
record stays traceable.
"""
from __future__ import annotations

import csv
import glob
import json
import os
import re
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import (FIELDS, OUT_DIR, ROOT, jaccard_est, minhash,  # noqa: E402
                    norm_key, sha1, word_count)

# Provenance ranking used to pick the survivor of a duplicate group.
SCORE_RANK = {"official": 0, "teacher_rated": 1, "self_reported": 2,
              "third_party_rated": 3, "estimated": 4, "none": 5, "": 5}
AUTH_RANK = {"confirmed": 0, "likely": 1, "uncertain": 2, "": 3}

MIN_WORDS = 100
MAX_WORDS = 3000

OUT_FIELDS = FIELDS + ["data_type", "subtype", "priority", "duplicate_count",
                       "duplicate_of_sources", "text_sha1"]

# Five-way split of "who produced the number, and how much should it be
# trusted" -- data_type (A/B) alone conflates a human community rating with a
# machine auto-grader score, which are not comparable as labels.
SUBTYPE = {
    "official": "A1_official",
    "teacher_rated": "A2_teacher_rated",
    "self_reported": "A2_teacher_rated",  # rare; same trust tier as A2
    "third_party_rated": "A3_community_rated",
    "estimated": "B1_machine_scored",
    "none": "B2_unscored",
    "": "B2_unscored",
}
SUBTYPE_MEANING = {
    "A1_official": "Scored by ETS GRE raters. The only ground-truth scores in this corpus.",
    "A2_teacher_rated": "Scored by a named prep instructor, or a self-reported real exam score.",
    "A3_community_rated": "Scored by a forum member / redditor. Weak label; rater skill unknown.",
    "B1_machine_scored": "Scored by an automated grader (testbig e-grader, GMATAWA auto-grader). "
                         "NOT a real GRE score -- do not treat as ground truth.",
    "B2_unscored": "No score of any kind.",
}

# Text that betrays a machine-generated "model answer" rather than a real
# candidate response. Used only to flag, never to silently drop.
AI_TELLS = re.compile(
    r"(as an ai language model|i'm sorry, (?:but )?i can(?:'t|not)|"
    r"here (?:is|'s) (?:a|an) (?:sample|model) (?:essay|response)|"
    r"certainly! |in conclusion, it is (?:clear|evident) that the (?:above|"
    r"foregoing))", re.I)


def load_stages():
    recs = []
    for path in sorted(glob.glob(os.path.join(OUT_DIR, "stage_*.json"))):
        with open(path, encoding="utf-8") as f:
            batch = json.load(f)
        print(f"  {os.path.basename(path):<28} {len(batch):>5}")
        recs += batch
    return recs


def quality_filter(recs):
    kept, dropped = [], Counter()
    for r in recs:
        wc = r.get("word_count") or word_count(r["essay_text"])
        r["word_count"] = wc
        # A one-sentence response that ETS officially scored a 1 is a genuine
        # (and rare) data point, so the length floor only applies to sources
        # where a short text is more likely to be a parsing failure.
        floor = 10 if r.get("score_type") in ("official", "teacher_rated") else MIN_WORDS
        if wc < floor:
            dropped["too_short"] += 1
            continue
        if wc > MAX_WORDS:
            dropped["too_long"] += 1
            continue
        letters = sum(c.isalpha() for c in r["essay_text"])
        if letters < 0.5 * len(r["essay_text"]):
            dropped["not_prose"] += 1
            continue
        if AI_TELLS.search(r["essay_text"]):
            r["human_authenticity"] = "uncertain"
            r["notes"] = (r.get("notes", "") +
                          " | FLAG: text contains a phrase typical of LLM output; "
                          "authenticity downgraded.").strip(" |")
            dropped["flagged_ai_tell"] += 1
        kept.append(r)
    print("  quality filter:", dict(dropped), f"-> {len(kept)} kept")
    return kept


def rank_key(r):
    return (SCORE_RANK.get(r.get("score_type", ""), 5),
            AUTH_RANK.get(r.get("human_authenticity", ""), 3),
            0 if r.get("prompt_text") else 1,
            -(r.get("word_count") or 0))


def dedup(recs):
    """Exact dedup on normalised text, then MinHash near-dup dedup."""
    by_key = defaultdict(list)
    for r in recs:
        by_key[norm_key(r["essay_text"])].append(r)
    exact_groups = list(by_key.values())
    print(f"  exact dedup: {len(recs)} -> {len(exact_groups)}")

    survivors = []
    for group in exact_groups:
        group.sort(key=rank_key)
        head = dict(group[0])
        head["duplicate_count"] = len(group) - 1
        head["duplicate_of_sources"] = " | ".join(
            sorted({g["source_url"] for g in group[1:] if g.get("source_url")}))
        survivors.append(head)

    # --- near duplicates: LSH banding over MinHash signatures --------------
    sigs = {i: minhash(r["essay_text"]) for i, r in enumerate(survivors)}
    bands, rows_per_band = 24, 4
    buckets = defaultdict(list)
    for i, sig in sigs.items():
        for b in range(bands):
            buckets[(b, sig[b * rows_per_band:(b + 1) * rows_per_band])].append(i)

    parent = list(range(len(survivors)))

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    checked = set()
    for members in buckets.values():
        if len(members) < 2 or len(members) > 60:
            continue
        for a in range(len(members)):
            for b in range(a + 1, len(members)):
                pair = (members[a], members[b])
                if pair in checked:
                    continue
                checked.add(pair)
                if jaccard_est(sigs[pair[0]], sigs[pair[1]]) >= 0.80:
                    union(*pair)

    clusters = defaultdict(list)
    for i in range(len(survivors)):
        clusters[find(i)].append(survivors[i])

    final = []
    for members in clusters.values():
        members.sort(key=rank_key)
        head = members[0]
        extra = sum(m.get("duplicate_count", 0) for m in members[1:]) + len(members) - 1
        head["duplicate_count"] = head.get("duplicate_count", 0) + extra
        others = {m["source_url"] for m in members[1:] if m.get("source_url")}
        if others:
            prev = head.get("duplicate_of_sources", "")
            head["duplicate_of_sources"] = " | ".join(
                sorted(set(filter(None, prev.split(" | "))) | others))
        final.append(head)
    print(f"  near-dup dedup: {len(survivors)} -> {len(final)}")
    return final


def label(recs):
    for r in recs:
        st = r.get("score_type", "none")
        auth = r.get("human_authenticity", "")
        r["subtype"] = SUBTYPE.get(st, "B2_unscored")
        has_real_score = st in ("official", "teacher_rated", "self_reported",
                                "third_party_rated")
        r["data_type"] = "A" if has_real_score else "B"
        if st == "official":
            r["priority"] = 1
        elif st in ("teacher_rated", "third_party_rated"):
            r["priority"] = 2
        elif st == "self_reported":
            r["priority"] = 2
        elif auth in ("confirmed", "likely"):
            r["priority"] = 3
        else:
            r["priority"] = 4
        r["text_sha1"] = sha1(r["essay_text"])
        for f in OUT_FIELDS:
            r.setdefault(f, "")
    # Safety net: essay_id is the join key downstream, so guarantee uniqueness
    # even if a collector ever produces a collision.
    seen = {}
    for r in recs:
        base = r["essay_id"]
        if base in seen:
            seen[base] += 1
            r["essay_id"] = f"{base}__{seen[base]}"
        else:
            seen[base] = 0
    return recs


def write_outputs(recs):
    recs.sort(key=lambda r: (r["priority"], r["source_name"], r["essay_id"]))
    csv_path = os.path.join(ROOT, "gre_human_essays.csv")
    json_path = os.path.join(ROOT, "gre_human_essays.json")
    with open(csv_path, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=OUT_FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in recs:
            w.writerow(r)
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(recs, f, ensure_ascii=False, indent=1)
    print(f"  -> {csv_path}\n  -> {json_path}")
    return csv_path, json_path


def statistics(recs):
    n = len(recs)
    scored = [r for r in recs if r["score_available"]]
    lines = []
    add = lines.append
    add("# GRE Human Essay Corpus - statistics\n")
    add(f"- **Total essays:** {n}")
    add(f"- **Type A (carry a score):** {sum(1 for r in recs if r['data_type']=='A')}")
    add(f"- **Type B (no score):** {sum(1 for r in recs if r['data_type']=='B')}")
    add(f"- **Total words:** {sum(r['word_count'] for r in recs):,}")
    add(f"- **Median length:** {sorted(r['word_count'] for r in recs)[n//2]} words\n")

    add("## Score availability by type\n")
    add("| score_type | essays | meaning |")
    add("|---|---:|---|")
    meaning = {
        "official": "rated by ETS GRE raters, published by ETS",
        "teacher_rated": "rated by a named prep-company instructor",
        "self_reported": "score the test taker says they received",
        "third_party_rated": "rated by a non-official human grader",
        "estimated": "automated/machine estimate - NOT a real GRE score",
        "none": "no score attached",
    }
    for st, c in Counter(r["score_type"] for r in recs).most_common():
        add(f"| {st} | {c} | {meaning.get(st,'')} |")

    add("\n## Subtype (who produced the label, and how much to trust it)\n")
    add("`data_type` A/B only distinguishes \"has a score\" from \"has no score\" "
        "-- it does not distinguish a human rating from a machine one. Filter "
        "on `subtype` instead when that distinction matters.\n")
    add("| subtype | essays | meaning |")
    add("|---|---:|---|")
    for sub in ["A1_official", "A2_teacher_rated", "A3_community_rated",
               "B1_machine_scored", "B2_unscored"]:
        c = sum(1 for r in recs if r["subtype"] == sub)
        if c:
            add(f"| {sub} | {c} | {SUBTYPE_MEANING[sub]} |")

    add("\n## Score distribution (all scored essays)\n")
    add("| score | essays | of which official |")
    add("|---|---:|---:|")
    by_score = Counter(r["score"] for r in scored)
    off = Counter(r["score"] for r in scored if r["score_type"] == "official")
    for s in sorted(by_score, key=lambda x: float(x)):
        add(f"| {s} | {by_score[s]} | {off.get(s,0)} |")

    add("\n## Human authenticity\n")
    add("| level | essays |")
    add("|---|---:|")
    for a, c in Counter(r["human_authenticity"] for r in recs).most_common():
        add(f"| {a} | {c} |")

    add("\n## Essay task type\n")
    add("| type | essays |")
    add("|---|---:|")
    for t, c in Counter(r["essay_type"] for r in recs).most_common():
        add(f"| {t} | {c} |")

    add("\n## By source\n")
    add("| source | essays | with score | confirmed human | likely | uncertain |")
    add("|---|---:|---:|---:|---:|---:|")
    for src, c in Counter(r["source_name"] for r in recs).most_common():
        sub = [r for r in recs if r["source_name"] == src]
        add(f"| {src} | {c} | {sum(1 for r in sub if r['score_available'])} | "
            f"{sum(1 for r in sub if r['human_authenticity']=='confirmed')} | "
            f"{sum(1 for r in sub if r['human_authenticity']=='likely')} | "
            f"{sum(1 for r in sub if r['human_authenticity']=='uncertain')} |")

    add("\n## Publication year (where known)\n")
    years = Counter(r["publication_date"][:4] for r in recs if r["publication_date"])
    add("| year | essays |")
    add("|---|---:|")
    for y in sorted(years):
        add(f"| {y} | {years[y]} |")
    unknown = sum(1 for r in recs if not r["publication_date"])
    add(f"| (unknown) | {unknown} |")

    add("\n## Duplicates removed\n")
    dupes = sum(r["duplicate_count"] for r in recs)
    add(f"{dupes} duplicate/near-duplicate copies were collapsed into the "
        f"{n} unique records above. The URLs of collapsed copies are kept in "
        "`duplicate_of_sources`.")

    text = "\n".join(lines) + "\n"
    path = os.path.join(ROOT, "statistics.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)
    print(f"  -> {path}")
    print("\n" + text)


SOURCE_NOTES = {
    "ETS (ets.org) official GRE Analytical Writing sample responses":
        "Real test-taker responses published by ETS at every score point with "
        "official rater commentary. ETS states they are reproduced exactly as "
        "written. Highest-confidence records in the corpus.",
    "ETS (ets.org) official GRE practice test sample essays":
        "Same provenance as above, taken from the free ETS practice-test "
        "response booklets (Practice Test 1 and 3).",
    "Magoosh GRE Blog - real student essays with scores":
        "Essays written by Magoosh students, each scored 0-6 by a Magoosh GRE "
        "expert in the published analysis. Teacher rating, not an ETS score.",
    "testbig.com (GMAT/GRE essay community) via Internet Archive":
        "Practice essays pasted by named registered users, mostly 2014-2019. "
        "Any score is the site's automated e-grader, recorded as 'estimated'. "
        "Collected from the Internet Archive; the live site is down.",
    "GRE Prep Club (MyPrepClub) AWA forum":
        "Test takers posting their own practice essay for community feedback, "
        "2015-2026. Replies are sparse and the scores in them are nearly all "
        "GMATAWA auto-grader reports ('estimated'); genuine human ratings are "
        "rare. Read through the account holder's own logged-in browser because "
        "the domain refuses anonymous requests.",
    "ArguGPT corpus (Kaggle) - human essays":
        "The human half of the ArguGPT benchmark (Hu et al. 2023), which was "
        "built to separate human from machine argumentative writing. No 0-6 "
        "scores; the corpus carries proficiency bands, kept in `notes`.",
}


def source_report(recs):
    lines = ["# Source report\n",
             "One row per source. \"With score\" counts any score of any type; "
             "see `score_type` in the data for which are real human/official "
             "ratings and which are machine estimates.\n",
             "| Source | Essays | With score | Score types | Human authenticity "
             "| Notes |", "|---|---:|---:|---|---|---|"]
    for src, n in Counter(r["source_name"] for r in recs).most_common():
        sub = [r for r in recs if r["source_name"] == src]
        st = ", ".join(f"{k}:{v}" for k, v in
                       Counter(r["score_type"] for r in sub).most_common())
        auth = ", ".join(f"{k}:{v}" for k, v in
                         Counter(r["human_authenticity"] for r in sub).most_common())
        note = SOURCE_NOTES.get(src, "")
        if not note and src.startswith("Reddit"):
            note = ("Self-posts in which a test taker pastes their own practice "
                    "essay for feedback. Scores, where present, come from the "
                    "poster or from a grader in the comment thread.")
        lines.append(f"| {src} | {n} | "
                     f"{sum(1 for r in sub if r['score_available'])} | {st} | "
                     f"{auth} | {note} |")

    lines.append("\n## Access notes\n")
    lines.append("- **ETS**: public PDFs on ets.org, no restrictions.")
    lines.append("- **Magoosh**: public blog post, no restrictions.")
    lines.append("- **Reddit**: reddit.com blocks this environment (HTTP 403); "
                 "data came from the public Arctic Shift mirror instead.")
    lines.append("- **testbig.com**: live site down for maintenance; data came "
                 "from the Internet Archive, which rate-limits to roughly "
                 "15 pages/minute.")
    lines.append("- **GRE Prep Club**: refuses anonymous requests (Cloudflare, "
                 "HTTP 403); collected by reading the pages inside the account "
                 "holder's own logged-in browser session.")
    lines.append("- **Urch / TestMagic**: still blocked (HTTP 403). See "
                 "`potential_sources_requiring_human_action.md`.")
    lines.append("- **ArguGPT**: the authors publish only an index on GitHub, "
                 "but the corpus itself is mirrored publicly on Kaggle.")

    path = os.path.join(ROOT, "source_report.md")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"  -> {path}")


def main():
    print("loading stages:")
    recs = load_stages()
    print(f"  total raw: {len(recs)}")
    recs = quality_filter(recs)
    recs = dedup(recs)
    recs = label(recs)
    write_outputs(recs)
    source_report(recs)
    statistics(recs)


if __name__ == "__main__":
    main()
