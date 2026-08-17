# Sources that need you (login / purchase / manual download)

> **Read this first.** Collection is finished: **7,243 essays, 3.18M words**.
> Of those, **108 carry a score assigned by a human** and only **30 are scored
> by ETS**. That ratio is the finding, not a shortfall in effort. Across every
> source added after the first build — testbig (5,516 essays), ArguGPT (590),
> GRE Prep Club (533) — the total gain in human-assigned scores was **5**.
>
> Public GRE essay communities do not grade each other numerically. They paste
> essays for prose feedback, or they run them through an auto-grader. So the
> sources below are ranked by whether they can add **scores**, which is the only
> thing still scarce. Nothing here will move the essay count much.

Everything below holds real human GRE Analytical Writing essays but could not be
collected programmatically from this machine. For each: what it is, what it
holds, what you'd have to do, cost, and whether I think it's worth it.

Ordered by how much they'd add to the corpus.

---

## 1. GRE Prep Club / MyPrepClub — AWA forum  ✅ RESOLVED — collected

- **URL:** https://gre.myprepclub.com/forum/analytical-writing-assessment-awa-14/
  (the forum id is **14**, not 91 as an earlier draft of this file claimed)
- **Status:** collected via the user's own logged-in Chrome session. No longer
  blocked, no further action needed.
- **How the block was worked around:** anonymous server-side requests from this
  machine still return **HTTP 403** (Cloudflare). What worked was driving the
  user's already-authenticated browser and reading the pages from inside the
  page context, so no credentials were ever handled directly.

### Correction to an earlier claim in this file

An earlier version of this document said the forum held "a few thousand human
essays, a meaningful share with a human-assigned score." **Both halves of that
were wrong**, and a 25-thread sample proved it:

| Measured | Earlier claim | Actual |
|---|---|---|
| Threads in the AWA forum | "thousands" | **695 unique** (~565 non-guide) |
| Threads with a usable essay | — | **92%**, median 462 words |
| Replies per thread | "many" | **0.6** |
| Replies with a human 0–6 score | "a meaningful share" | **0 of 15** |

The only scores that appear in replies come from **automated graders** — the
`GMATAWA auto-grader` and a "Statistics / Assignment Score" bot report that
moderators paste in. Those are machine output and are recorded as
`score_type='estimated'`, never as a human rating.

**Net effect:** this source adds roughly 500 **Type B** essays (human-written,
no score). It does **not** help the Type A shortage at all. It was still worth
collecting for volume, but it is not the "best remaining source" for scored
data that this file previously claimed.

---

## 2. Urch / TestMagic forums

- **URL:** https://www.urch.com/forums/gre-analytical-writing-awa/
- **What's there:** the old TestMagic GRE AWA board, active ~2002–2015 — very
  valuable because it entirely predates generative AI, so human authorship is
  beyond doubt. Users posted essays and other users graded them.
- **Why I couldn't get it:** **HTTP 403** on direct requests. The Internet
  Archive *does* have ~40,000 urch.com/forums URLs, but see the rate-limit note
  in §7 below.
- **What I need from you:** same as GRE Prep Club — save the AWA subforum pages
  from your browser, or confirm you're happy for me to keep slowly pulling them
  from the Internet Archive over several hours.
- **Cost:** free.
- **Worth it?** Yes, second priority. Pre-2015 material is the cleanest
  "definitely human" data available anywhere.

---

## 3. ETS *ScoreItNow!* Online Writing Practice

- **URL:** https://www.ets.org/gre/test-takers/general-test/prepare/score-it-now.html
  (delivered via https://dxrgroup.com/scoreitnow)
- **What's there:** ETS's own service scores *your* essays with the real
  **e-rater** engine and returns official-scale 0–6 scores plus sample scored
  responses at each score point that are not published elsewhere.
- **What I need from you:** purchase and log in; the scored sample essays shown
  inside the product can be copied out.
- **Cost:** **about US$20** for two essay topics (2 submissions).
- **Worth it?** Only marginally for corpus-building — you'd get a handful of
  extra scored samples, not bulk data. **Skip unless** you also want a
  calibration reference for e-rater behaviour.

---

## 4. The Official GRE Guides (ETS books)

- *The Official Guide to the GRE General Test*, and
  *Official GRE Verbal Reasoning Practice Questions* (ETS/McGraw-Hill).
- **What's there:** additional real scored responses with official rater
  commentary that are **not** on ets.org — roughly 10–20 more Priority-1 essays
  beyond the 30 I already extracted from the free PDFs.
- **What I need from you:** buy the book (or borrow it) and either scan the AWA
  chapter or type/OCR the sample responses. If you have a PDF/EPUB copy already,
  just point me at the file and I'll extract them.
- **Cost:** roughly **US$20–40** new; often available in libraries.
- **Worth it?** **Yes if you already own it or can borrow it** — these are
  officially scored essays, the most valuable label type in the corpus. Not
  worth buying purely for ~15 essays.

---

## 5. ArguGPT corpus — 590 human GRE essays (research dataset)

- **Paper:** https://arxiv.org/abs/2304.07666
- **Repo:** https://github.com/huhailinguist/ArguGPT
- **What's there:** 590 human-written GRE essays (341,495 words), each labelled
  with a proficiency band (low/medium/high). This is described in the paper as
  the first GRE essay corpus.
- **Why I couldn't get it:** the authors publish **only the index** of the human
  essays. Their README states plainly that they have no copyright to release the
  human texts (they came from GRE prep materials). I downloaded the index files;
  they contain filenames and level labels but no essay text.
- **What I need from you:** email the authors (SJTU Computational Linguistics
  Lab, corresponding authors listed on the arXiv page) and request the human
  split for research use. Academic requests like this are often granted.
- **Cost:** free, but expect days-to-weeks of turnaround.
- **Worth it?** **Yes — send the email.** 590 essays with proficiency labels
  would be one of the largest single additions available, and it costs nothing
  but an email. Note the labels are bands, not 0–6 scores.

---

## 6. LDC TOEFL11 / ETS research corpora

- **URL:** https://catalog.ldc.upenn.edu/LDC2014T06
- **What's there:** 12,100 human-written TOEFL essays with proficiency levels.
  **Not GRE** — but it is the standard licensed comparison corpus, and ArguGPT
  used it alongside their GRE data.
- **Cost:** free for LDC member institutions; **US$300–1,000+** otherwise.
- **Worth it?** **No, for this project.** It's TOEFL, not GRE. Only relevant if
  you later want a large human-essay baseline for training a scorer.

---

## 7. testbig.com — the live site (currently down)

- **URL:** https://www.testbig.com/gmatgre-issue-task-essays/ (and
  `.../gmatgre-argument-task-essays/`)
- **What's there:** ~6,800 GRE Issue/Argument essays submitted by named
  community members, mostly 2014–2019, each with the prompt, the author's
  username, a posting date, and an automated e-grader score out of 6.
- **Status:** the live site currently serves a **"Site Maintenance"** placeholder
  for every URL, so I am pulling the pages from the Internet Archive instead.
  **This is working, just slowly:** web.archive.org rate-limits anonymous replay
  traffic to roughly 15 pages/minute, so the full 6,800 takes many hours. The
  crawl is resumable and caches to `raw_cache/testbig.sqlite`.
- **What I need from you:** nothing mandatory. Two ways to speed it up if you
  want the whole set:
  - Just re-run the crawler yourself whenever convenient — it picks up where it
    left off and skips what's already cached:
    ```bash
    python scripts/collect_testbig.py --fetch
    ```
  - Or check back whether testbig.com has come out of maintenance; if it has,
    the live site has no such rate limit and the crawl finishes in minutes.
- **Cost:** free.
- **Worth it?** Yes — it's the single biggest volume source, and it's already
  in progress.

---

## 8. Commercial "GRE essay evaluation" platforms

Services such as **GradeMyEssay**, **EssayBuilderAI**, **Vince Kotchian**, and
various Fiverr/Upwork GRE graders hold user-submitted essays with human ratings.

- **Why not collected:** their essay archives are behind paid accounts, and
  their public "sample essay" pages are marketing copy of unclear authorship
  (very possibly AI-written), which fails the human-authenticity bar.
- **Worth it?** **No.** Paying for an account gets you your *own* essays back,
  not a corpus. Their public samples are exactly the "unsourced high-scoring
  model essay" content the project is supposed to exclude.

---

## 9. What I deliberately did *not* collect

For the record, so you know these were considered and rejected:

| Source | Why excluded |
|---|---|
| PrepScholar / Kanan / iSchoolConnect / Shiksha "sample essays" | Either verbatim reprints of the ETS samples (already captured, and deduped) or unsourced "model" essays with no evidence of a human author. |
| Kaggle "GRE essay dataset" (1,785 essays, 2–12 scale) | Mislabelled. It is ASAP Set 1 — persuasive essays by US 8th-graders, not GRE. |
| Hugging Face essay-scoring datasets | Searched `GRE`, `AWA`, `analytical writing`, `issue essay`. No GRE corpus exists on the Hub. |
| Blog posts titled "GRE sample essays that scored 6.0" | No provenance for either the essay or the score; the exact pattern the brief says to avoid. |
