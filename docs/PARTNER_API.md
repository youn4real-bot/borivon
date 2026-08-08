# Borivon Partner API — integration guide

**Give this document and an API key to your partner. It is written so their
developer *or* their AI assistant (Claude, Codex, Copilot) can implement the
integration from this file alone, without asking us anything.**

---

## What this is

Borivon places Moroccan nurses with German employers. When we agree to work a
candidate with you, we press **"Send to \<your agency\>"** on that person in our
portal. From that moment, your system can fetch her details and download her
documents automatically — so the same files are not uploaded by hand into two
portals.

**You will only ever see candidates we have explicitly shared with you.** There
is no endpoint that lists our roster, and a candidate we have not shared returns
`404` — the same as an id that does not exist.

Base URL:

```
https://www.borivon.com/api/partner/v1
```

## Authentication

Send your key on every request. Either header works — use whichever your stack
prefers:

```
Authorization: Bearer bv_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

```
X-API-Key: bv_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

The key identifies your agency. Treat it like a password: it can read your
candidates' passports. Store it in a secret manager or an environment variable,
never in source control, never in a browser. If it leaks, tell us and we will
revoke it — revocation takes effect on your very next request.

**Do not call this API from a browser.** It is server-to-server. There is no
CORS allowance, by design.

---

## 1. List the candidates shared with you

```http
GET /api/partner/v1/candidates
Authorization: Bearer <key>
```

```json
{
  "count": 2,
  "candidates": [
    {
      "id": "3c73174d-9f91-4c89-bfaf-5653d5f291b1",
      "first_name": "AMINA",
      "last_name": "ACHOUKI",
      "date_of_birth": "1996-04-12",
      "sex": "F",
      "nationality": "Marokkanisch",
      "passport_number": "XB9015219",
      "passport_expiry": "2029-11-03",
      "documents": [
        {
          "id": "66406f84-3fb9-44af-a273-a4909e6be0d1",
          "file_name": "amina_achouki_pflegekraft_reisepass.pdf",
          "file_type": "Reisepass",
          "uploaded_at": "2026-05-19T01:21:39.720Z",
          "sha256": "9f2b…"
        }
      ]
    }
  ]
}
```

Notes:

- `id` is stable. Use it as your foreign key for the candidate.
- `documents[].id` is stable too, and is what you pass to the download call.
- **`sha256` is the fingerprint of the file's bytes.** Store it. If it has not
  changed since your last sync, the file has not changed — skip the download.
  This is how you poll cheaply.
- Only **approved** documents appear. Anything we rejected, replaced, or have
  not reviewed yet is never listed.
- `file_type` is a human label and arrives in French, German or English
  depending on the candidate's own portal language (`Reisepass`, `Passeport`,
  `B2 Sprachzertifikat`, `Certificat de langue B2`…). **Do not branch on its
  exact spelling.** If you need to categorise, match loosely and case-insensitively.

## 2. Download a document

```http
GET /api/partner/v1/documents/{document_id}
Authorization: Bearer <key>
```

Returns the **raw file bytes** with `Content-Type` and a
`Content-Disposition: attachment; filename="…"` carrying our filename.

These are the original bytes exactly as the candidate uploaded them — we never
re-encode a passport, because re-saving a scanned passport PDF can destroy the
machine-readable strip at the bottom that a German authority's reader depends on.

---

## How to sync (recommended shape)

1. Call `GET /candidates` on a schedule — **every 15–60 minutes is plenty.**
   Nothing here changes by the second.
2. For each candidate, upsert into your system keyed on `id`.
3. For each document, compare `sha256` with what you already stored.
   - Unknown id, or a changed `sha256` → download it.
   - Same `sha256` → skip. Do not re-download.
4. A candidate who disappears from the list has been **un-shared**. Stop showing
   her documents. (We are not telling you to delete them; that is your call and
   your retention policy.)

**Do not download every document on every poll.** That is what `sha256` is for.

## Rate limit

120 requests per minute. Over that you get `429` with a `Retry-After` header in
seconds — wait that long and retry. If you back off properly you will never see
this.

## Errors

| Status | Meaning | What to do |
|---|---|---|
| `401` | Key missing, malformed, or revoked | Check the header. If it was working, ask us — it may be revoked. |
| `404` | Not shared with you, not approved, or does not exist | Not an error to retry. Re-sync the list. |
| `429` | Too fast | Honour `Retry-After`. |
| `5xx` | Our side | Retry with backoff. Do not hammer. |

All errors are JSON: `{"error":"invalid_api_key"}`.

---

## Data protection

The data behind this key includes passports and identity details of real people.

- Use it only for the placement work we are doing together.
- Store it encrypted at rest; do not put it in a shared drive or a group chat.
- Do not pass it to a further third party without asking us first.
- **Every call is logged on our side** — which key, which candidate, which
  document, when. If a candidate asks us who has seen her passport, we answer
  from that log.
- Tell us immediately if the key is exposed, or if you no longer need it.

## Getting help

Contact your Borivon representative. When reporting a problem, include the
**first 16 characters of your key** (e.g. `bv_live_a1b2c3d4`) — that identifies
which key without revealing it. **Never send us the whole key.**
