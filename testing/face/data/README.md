# Face recognition test data

Labeled photos for the face-recognition accuracy runner: `testing/face/run.ts`.

The runner uses the **real** production face service (AWS Rekognition): it
enrols the gallery via `enrollFace`, then scores probes via
`recognizeAllFaces` (both from `src/services/face-service.ts`). **No numbers are
fabricated** — if the data folders are empty (only this README), the runner
prints `no test data found in testing/face/data — see README` and exits 0.

> ⚠️ **This runner writes to a Rekognition collection.** It indexes the gallery
> faces. Use a dedicated test collection:
> `AWS_REKOGNITION_COLLECTION_ID=suhail-faces-test`. Do not point it at the
> production collection.

## Layout

```
testing/face/data/enroll/enroll.csv   + <one clear photo per identity>
testing/face/data/probe/labels.csv    + <probe image files>
```

- `enroll/` — the gallery. One (or a few) clear frontal photos per identity to
  enrol.
- `probe/` — the test set: more photos of the enrolled people, PLUS distractor
  (never-enrolled) faces and no-face images. All probe images live in `probe/`.

## Label scheme

### `enroll/enroll.csv` — header columns `filename,name`

```csv
filename,name
abdullah_front.jpg,Abdullah
sara_front.jpg,Sara
```

### `probe/labels.csv` — header columns `filename,identity`

`identity` is one of:
- an **enrolled name** (must exactly match a `name` from `enroll.csv`) — a
  positive probe,
- `__unenrolled__` — a real face of a person who was **never** enrolled
  (distractor),
- `__noface__` — an image with **no face** at all.

```csv
filename,identity
abdullah_002.jpg,Abdullah
abdullah_003.jpg,Abdullah
sara_002.jpg,Sara
stranger_001.jpg,__unenrolled__
empty_room_001.jpg,__noface__
```

## Image format (match production capture)

- Resolution **1920×1080**, **JPEG**, medium compression.
- Read as raw bytes → base64 (no `data:` prefix) — the runner handles this.

## Sample sizes

- **≥ 50 positive probes per enrolled identity**, 100 preferred (across
  varied lighting / angles).
- Distractors (`__unenrolled__`): **at least 10** never-enrolled faces.
- No-face (`__noface__`): **at least 10** images with no face.

## Metrics computed

- **Precision + recall per enrolled identity**, and overall (micro-averaged):
  - TP = probe of identity X recognized as X.
  - FP = probe recognized as X when the true identity is not X (includes
    distractor / no-face false accepts).
  - FN = probe of identity X not recognized as X.
- **False-accept rate (separate rows)**:
  - on **unenrolled distractor** faces (fraction recognized as some known
    person),
  - on **no-face** images (fraction returning a known person).

## Output

Results written to `testing/results/face_accuracy_<timestamp>.json` plus a
matching `.md`; summary printed to console.
