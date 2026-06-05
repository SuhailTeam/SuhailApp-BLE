# System Usability Scale (SUS) — administration form

The standard 10-item SUS (Brooke, 1996). Each participant rates every statement
**1–5**: 1 = Strongly disagree, 5 = Strongly agree. Administer the **same 10
items** to every participant, alternating positive/negative tone as below.

| # | Statement | 1 (Disagree) → 5 (Agree) |
|---|---|---|
| q1 | I think that I would like to use this system frequently. | ☐ 1 ☐ 2 ☐ 3 ☐ 4 ☐ 5 |
| q2 | I found the system unnecessarily complex. | ☐ 1 ☐ 2 ☐ 3 ☐ 4 ☐ 5 |
| q3 | I thought the system was easy to use. | ☐ 1 ☐ 2 ☐ 3 ☐ 4 ☐ 5 |
| q4 | I think that I would need the support of a technical person to be able to use this system. | ☐ 1 ☐ 2 ☐ 3 ☐ 4 ☐ 5 |
| q5 | I found the various functions in this system were well integrated. | ☐ 1 ☐ 2 ☐ 3 ☐ 4 ☐ 5 |
| q6 | I thought there was too much inconsistency in this system. | ☐ 1 ☐ 2 ☐ 3 ☐ 4 ☐ 5 |
| q7 | I would imagine that most people would learn to use this system very quickly. | ☐ 1 ☐ 2 ☐ 3 ☐ 4 ☐ 5 |
| q8 | I found the system very cumbersome to use. | ☐ 1 ☐ 2 ☐ 3 ☐ 4 ☐ 5 |
| q9 | I felt very confident using the system. | ☐ 1 ☐ 2 ☐ 3 ☐ 4 ☐ 5 |
| q10 | I needed to learn a lot of things before I could get going with this system. | ☐ 1 ☐ 2 ☐ 3 ☐ 4 ☐ 5 |

> For a blind/low-vision study the moderator reads each statement aloud and records
> the spoken 1–5 answer. (Odd items are positively worded, even items negatively
> worded — that alternation is intentional; don't "fix" it.)

## Scoring (done automatically by `analyze.ts`)

- Odd items (q1,q3,q5,q7,q9): contribution = response − 1
- Even items (q2,q4,q6,q8,q10): contribution = 5 − response
- Participant SUS = (sum of the 10 contributions) × 2.5  → 0–100
- Study SUS = mean across participants

## Recording the responses

One CSV per participant in `testing/usability/sus/` named `P1.csv … P5.csv`:

```
q1,q2,q3,q4,q5,q6,q7,q8,q9,q10
4,2,5,1,4,1,5,2,4,1
```

Then re-run `bun run testing/usability/analyze.ts` (or just paste the ten numbers
per participant to me and I'll build the files and score them).

## Integrity note

Enter only the **participants' own answers** from the sessions. If SUS was not
actually administered to them, report it as "SUS not administered" — reconstructed
or self-filled SUS scores are fabricated data, exactly like invented latencies, and
have no place in the report.
