# Smoke test checklist

Run after every prod deploy. Catches the ~10 ways the portal could
silently break without anyone noticing.

Two browser tabs side-by-side:
- **A** — supreme admin (you, on www.borivon.com).
- **B** — a real test candidate account (e.g. Soufiane), incognito so
  the session doesn't collide.

Each step has an expected result. If anything fails, screenshot + tell
Claude exactly which step.

---

## 1. Login still works

- A: open `/portal` → log in with admin email. Lands on `/portal/admin`. ✅
- B: open `/portal` incognito → log in with candidate. Lands on `/portal/dashboard`. ✅

## 2. Candidate dashboard renders

- B: see the documents list, the journey progress, the CV builder button.
- Bell + chat + profile icons visible top-right.
- No spinner stuck.

## 3. CV builder loads both sides

- A: click any candidate → CV button → CV builder opens with their data.
- B: click "Mein Lebenslauf" → CV builder opens with own data.
- Top-right shows one avatar (yourself).

## 4. Live collab works

- Both A and B keep their CV builder open for the **same candidate**.
- After ~2 seconds, **two avatars** appear in the top-right row.
- Click a field on side A → small floating disc with A's avatar lands on
  that field on side B. (On B's side it appears as a Borivon "B" if A
  is an admin.)
- Type on A → side B sees the change within ~1 second.

## 5. Status modal assignment

- A: open the Status modal for a test candidate → Assign tab.
- Click an agency (e.g. Calmaroi). Then click a site (e.g. UKSH Kiel).
- Close modal. Re-open it. The selection stays highlighted.
- Below the picker, see the 3-pill "CV branding" control. "Agency" is
  highlighted (default).

## 6. CV branding modes

For the candidate you just assigned:
- A: click "Agency" pill → download their CV (admin-side from the
  candidate card). Logo + footer = the agency's. ✅
- A: click "Borivon" pill → download CV. Logo + footer = Borivon's. ✅
- A: click "No branding" pill → download CV. No logo top, no footer. ✅
- B: log in as that candidate → download own CV. **Always Borivon** no
  matter what A picked.

## 7. Cover letter sender block

- B: open cover letter (`/portal/motivationsschreiben`).
- Sender block top-right shows the candidate's name + address (from
  passport approved data, OR from CV builder if entered).
- Long addresses wrap inside the right half of the page; no word splits
  mid-character.
- Recipient block top-left shows the assigned employer's name + address.

## 8. Phone updates live

- A: open candidate's CV builder, change the phone field. Wait 2 s.
- B: open candidate's cover letter (already open). Phone updates within
  ~5 s.

## 9. Notifications quiet on placement

- A: open Status → Assign → assign candidate to an agency.
- B: check the bell. Should be no new "matched" / "placement" ping.
- Dashboard partner-org card appears within 30 s but with no fanfare.

## 10. Profile photo

- A: click profile icon → My Profile → upload a photo. Photo appears in
  the top-right corner.
- Open a candidate's CV builder. Top-right collab avatar row shows
  YOUR photo. Other admins see it too. Candidate sees Borivon "B"
  instead.

---

## If any step fails

Tell Claude in this format:
> Step 6 — clicked "Borivon" pill, downloaded CV, still saw the
> Calmaroi logo. Expected: Borivon logo.

The expected vs. actual contrast is the fastest diagnosis path.
