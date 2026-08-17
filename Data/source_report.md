# Source report

One row per source. "With score" counts any score of any type; see `score_type` in the data for which are real human/official ratings and which are machine estimates.

| Source | Essays | With score | Score types | Human authenticity | Notes |
|---|---:|---:|---|---|---|
| testbig.com (GMAT/GRE essay community) via Internet Archive | 5516 | 2002 | none:3514, estimated:2002 | confirmed:3160, likely:2319, uncertain:37 | Practice essays pasted by named registered users, mostly 2014-2019. Any score is the site's automated e-grader, recorded as 'estimated'. Collected from the Internet Archive; the live site is down. |
| ArguGPT corpus (Kaggle) - human essays | 590 | 0 | none:590 | confirmed:547, uncertain:43 | The human half of the ArguGPT benchmark (Hu et al. 2023), which was built to separate human from machine argumentative writing. No 0-6 scores; the corpus carries proficiency bands, kept in `notes`. |
| Reddit r/GRE | 554 | 65 | none:489, third_party_rated:63, estimated:2 | confirmed:487, likely:67 | Self-posts in which a test taker pastes their own practice essay for feedback. Scores, where present, come from the poster or from a grader in the comment thread. |
| GRE Prep Club (MyPrepClub) AWA forum | 533 | 10 | none:523, third_party_rated:5, estimated:5 | confirmed:488, likely:45 | Test takers posting their own practice essay for community feedback, 2015-2026. Replies are sparse and the scores in them are nearly all GMATAWA auto-grader reports ('estimated'); genuine human ratings are rare. Read through the account holder's own logged-in browser because the domain refuses anonymous requests. |
| ETS (ets.org) official GRE practice test sample essays | 18 | 18 | official:18 | confirmed:18 | Same provenance as above, taken from the free ETS practice-test response booklets (Practice Test 1 and 3). |
| ETS (ets.org) official GRE Analytical Writing sample responses | 12 | 12 | official:12 | confirmed:12 | Real test-taker responses published by ETS at every score point with official rater commentary. ETS states they are reproduced exactly as written. Highest-confidence records in the corpus. |
| Reddit r/GREhelp | 10 | 1 | none:9, third_party_rated:1 | confirmed:8, likely:2 | Self-posts in which a test taker pastes their own practice essay for feedback. Scores, where present, come from the poster or from a grader in the comment thread. |
| Magoosh GRE Blog - real student essays with scores | 8 | 8 | teacher_rated:8 | confirmed:8 | Essays written by Magoosh students, each scored 0-6 by a Magoosh GRE expert in the published analysis. Teacher rating, not an ETS score. |
| Reddit r/gradadmissions | 1 | 1 | third_party_rated:1 | confirmed:1 | Self-posts in which a test taker pastes their own practice essay for feedback. Scores, where present, come from the poster or from a grader in the comment thread. |
| Reddit r/ApplyingToCollege | 1 | 0 | none:1 | likely:1 | Self-posts in which a test taker pastes their own practice essay for feedback. Scores, where present, come from the poster or from a grader in the comment thread. |

## Access notes

- **ETS**: public PDFs on ets.org, no restrictions.
- **Magoosh**: public blog post, no restrictions.
- **Reddit**: reddit.com blocks this environment (HTTP 403); data came from the public Arctic Shift mirror instead.
- **testbig.com**: live site down for maintenance; data came from the Internet Archive, which rate-limits to roughly 15 pages/minute.
- **GRE Prep Club**: refuses anonymous requests (Cloudflare, HTTP 403); collected by reading the pages inside the account holder's own logged-in browser session.
- **Urch / TestMagic**: still blocked (HTTP 403). See `potential_sources_requiring_human_action.md`.
- **ArguGPT**: the authors publish only an index on GitHub, but the corpus itself is mirrored publicly on Kaggle.
