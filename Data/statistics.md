# GRE Human Essay Corpus - statistics

- **Total essays:** 7243
- **Type A (carry a score):** 108
- **Type B (no score):** 7135
- **Total words:** 3,184,152
- **Median length:** 426 words

## Score availability by type

| score_type | essays | meaning |
|---|---:|---|
| none | 5126 | no score attached |
| estimated | 2009 | automated/machine estimate - NOT a real GRE score |
| third_party_rated | 70 | rated by a non-official human grader |
| official | 30 | rated by ETS GRE raters, published by ETS |
| teacher_rated | 8 | rated by a named prep-company instructor |

## Subtype (who produced the label, and how much to trust it)

`data_type` A/B only distinguishes "has a score" from "has no score" -- it does not distinguish a human rating from a machine one. Filter on `subtype` instead when that distinction matters.

| subtype | essays | meaning |
|---|---:|---|
| A1_official | 30 | Scored by ETS GRE raters. The only ground-truth scores in this corpus. |
| A2_teacher_rated | 8 | Scored by a named prep instructor, or a self-reported real exam score. |
| A3_community_rated | 70 | Scored by a forum member / redditor. Weak label; rater skill unknown. |
| B1_machine_scored | 2009 | Scored by an automated grader (testbig e-grader, GMATAWA auto-grader). NOT a real GRE score -- do not treat as ground truth. |
| B2_unscored | 5126 | No score of any kind. |

## Score distribution (all scored essays)

| score | essays | of which official |
|---|---:|---:|
| 1.0 | 53 | 5 |
| 2.0 | 40 | 5 |
| 2.5 | 11 | 0 |
| 3.0 | 758 | 5 |
| 3.5 | 248 | 0 |
| 4.0 | 725 | 5 |
| 4.5 | 80 | 0 |
| 5.0 | 185 | 5 |
| 5.5 | 7 | 0 |
| 6.0 | 10 | 5 |

## Human authenticity

| level | essays |
|---|---:|
| confirmed | 4729 |
| likely | 2434 |
| uncertain | 80 |

## Essay task type

| type | essays |
|---|---:|
| argument | 4049 |
| issue | 3102 |
| unknown | 92 |

## By source

| source | essays | with score | confirmed human | likely | uncertain |
|---|---:|---:|---:|---:|---:|
| testbig.com (GMAT/GRE essay community) via Internet Archive | 5516 | 2002 | 3160 | 2319 | 37 |
| ArguGPT corpus (Kaggle) - human essays | 590 | 0 | 547 | 0 | 43 |
| Reddit r/GRE | 554 | 65 | 487 | 67 | 0 |
| GRE Prep Club (MyPrepClub) AWA forum | 533 | 10 | 488 | 45 | 0 |
| ETS (ets.org) official GRE practice test sample essays | 18 | 18 | 18 | 0 | 0 |
| ETS (ets.org) official GRE Analytical Writing sample responses | 12 | 12 | 12 | 0 | 0 |
| Reddit r/GREhelp | 10 | 1 | 8 | 2 | 0 |
| Magoosh GRE Blog - real student essays with scores | 8 | 8 | 8 | 0 | 0 |
| Reddit r/gradadmissions | 1 | 1 | 1 | 0 | 0 |
| Reddit r/ApplyingToCollege | 1 | 0 | 0 | 1 | 0 |

## Publication year (where known)

| year | essays |
|---|---:|
| 2005 | 100 |
| 2006 | 2 |
| 2007 | 3 |
| 2008 | 4 |
| 2009 | 2 |
| 2010 | 3 |
| 2011 | 90 |
| 2012 | 130 |
| 2013 | 145 |
| 2014 | 89 |
| 2015 | 429 |
| 2016 | 888 |
| 2017 | 473 |
| 2018 | 229 |
| 2019 | 624 |
| 2020 | 392 |
| 2021 | 362 |
| 2022 | 191 |
| 2023 | 684 |
| 2024 | 17 |
| 2025 | 11 |
| 2026 | 18 |
| (unknown) | 2357 |

## Duplicates removed

204 duplicate/near-duplicate copies were collapsed into the 7243 unique records above. The URLs of collapsed copies are kept in `duplicate_of_sources`.
