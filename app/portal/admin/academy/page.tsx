"use client";

/**
 * ACADEMY — teacher (admin) panel. LIVE (wired to /api/portal/academy/admin).
 *
 * Teacher == admin: supreme Borivon admin runs every cohort; an org admin is
 * scoped to their org's cohorts + candidates (LAW #25, enforced server-side).
 * Flow: pick/create a cohort → add students → Start class → tap present/late/
 * absent → Give class bonus. Attendance feeds the reliability dossier; the bonus
 * fans out ledger points that surface on each student's Academy home in realtime.
 */
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useLang } from "@/components/LangContext";
import { PortalTopNav } from "@/components/PortalTopNav";
import { PageLoader } from "@/components/ui/states";
import { ArrowLeft, Play, Check, Clock, X, Plus, Gift, Users, Square, Search, ClipboardList, Trash2, Eye, EyeOff } from "lucide-react";

type Cohort = { id: string; name: string; targetLevel: string; memberCount: number; activeSession: { id: string; title: string; level: string } | null };
type Member = { candidateUserId: string; name: string; photo: string | null; level: string };
type Quiz = { id: string; title: string; kind: string; level: string; questionCount: number; pointsAward: number; published: boolean; submissions: number };
type DraftQ = { prompt: string; options: string[]; correct: number };
type Status = "present" | "late" | "absent" | undefined;
const LEVELS = ["A1", "A2", "B1", "B2"];

export default function AdminAcademyPage() {
  const { lang } = useLang();
  const router = useRouter();

  const T = {
    en: {
      title: "Academy — Teaching", desc: "Run classes, mark who showed up, reward your students.",
      cohorts: "Cohorts", newCohort: "New cohort", cohortName: "Cohort name", create: "Create",
      noCohorts: "No cohorts yet. Create your first class group.", members: "students",
      addStudents: "Add students", search: "Search…", add: "Add", selected: "selected",
      noMembers: "No students yet — add some to start.", cancel: "Cancel",
      startClass: "Start class", endClass: "End class", live: "LIVE",
      present: "Present", late: "Late", absent: "Absent", markEach: "Tap each student",
      giveBonus: "Give class bonus", bonusToAll: (n: number) => `+15 sent to ${n} present students 🎉`,
      classTitle: "Class title", level: "Level", scopeAll: "All cohorts", scopeOrg: "Your organization",
      quizzes: "Quizzes & homework", newQuiz: "New quiz", quizTitle: "Quiz title", kind: "Type",
      kHomework: "Homework", kQuiz: "Quiz", kExam: "Mock exam", addQuestion: "Add question",
      questionPrompt: "Question text", option: "Option", saveQuiz: "Save & publish",
      publish: "Publish", unpublish: "Unpublish", noQuizzes: "No quizzes yet — create one.",
      pointsLabel: "Points", correctHint: "Tap the dot to mark the correct answer",
      needQuestion: "Add at least one question (text, 2+ options, one marked correct).",
      done: "done", questionsWord: "questions",
      visTitle: "Academy visibility", visManage: "Who can see it",
      maskAll: "Hide Academy from everyone", maskAllSub: "Only you + people you allow see the tab.",
      visible: "Visible", hidden: "Hidden", reset: "Default",
      staffBadge: "Staff", candidateBadge: "Candidate", searchPeople: "Search people…",
    },
    fr: {
      title: "Académie — Enseignement", desc: "Lance les cours, marque les présents, récompense tes élèves.",
      cohorts: "Cohortes", newCohort: "Nouvelle cohorte", cohortName: "Nom de la cohorte", create: "Créer",
      noCohorts: "Aucune cohorte. Crée ton premier groupe.", members: "élèves",
      addStudents: "Ajouter des élèves", search: "Rechercher…", add: "Ajouter", selected: "sélectionné(s)",
      noMembers: "Aucun élève — ajoutes-en pour démarrer.", cancel: "Annuler",
      startClass: "Démarrer le cours", endClass: "Terminer", live: "EN DIRECT",
      present: "Présent", late: "Retard", absent: "Absent", markEach: "Touche chaque élève",
      giveBonus: "Bonus de classe", bonusToAll: (n: number) => `+15 envoyé à ${n} élèves présents 🎉`,
      classTitle: "Titre du cours", level: "Niveau", scopeAll: "Toutes les cohortes", scopeOrg: "Ton organisation",
      quizzes: "Quiz & devoirs", newQuiz: "Nouveau quiz", quizTitle: "Titre du quiz", kind: "Type",
      kHomework: "Devoir", kQuiz: "Quiz", kExam: "Examen blanc", addQuestion: "Ajouter une question",
      questionPrompt: "Texte de la question", option: "Option", saveQuiz: "Enregistrer & publier",
      publish: "Publier", unpublish: "Dépublier", noQuizzes: "Aucun quiz — crées-en un.",
      pointsLabel: "Points", correctHint: "Touche le point pour marquer la bonne réponse",
      needQuestion: "Ajoute au moins une question (texte, 2+ options, une correcte).",
      done: "faits", questionsWord: "questions",
      visTitle: "Visibilité Académie", visManage: "Qui peut la voir",
      maskAll: "Masquer l'Académie pour tous", maskAllSub: "Seul toi + les personnes autorisées voient l'onglet.",
      visible: "Visible", hidden: "Masqué", reset: "Défaut",
      staffBadge: "Équipe", candidateBadge: "Candidat", searchPeople: "Rechercher…",
    },
    de: {
      title: "Akademie — Unterricht", desc: "Kurse leiten, Anwesenheit markieren, Schüler belohnen.",
      cohorts: "Kohorten", newCohort: "Neue Kohorte", cohortName: "Kohortenname", create: "Erstellen",
      noCohorts: "Noch keine Kohorten. Erstelle deine erste Gruppe.", members: "Schüler",
      addStudents: "Schüler hinzufügen", search: "Suchen…", add: "Hinzufügen", selected: "ausgewählt",
      noMembers: "Noch keine Schüler — füge welche hinzu.", cancel: "Abbrechen",
      startClass: "Kurs starten", endClass: "Beenden", live: "LIVE",
      present: "Anwesend", late: "Verspätet", absent: "Abwesend", markEach: "Tippe jeden Schüler",
      giveBonus: "Klassen-Bonus", bonusToAll: (n: number) => `+15 an ${n} anwesende Schüler 🎉`,
      classTitle: "Kurstitel", level: "Niveau", scopeAll: "Alle Kohorten", scopeOrg: "Deine Organisation",
      quizzes: "Quiz & Hausaufgaben", newQuiz: "Neues Quiz", quizTitle: "Quiz-Titel", kind: "Typ",
      kHomework: "Hausaufgabe", kQuiz: "Quiz", kExam: "Probeprüfung", addQuestion: "Frage hinzufügen",
      questionPrompt: "Fragetext", option: "Option", saveQuiz: "Speichern & veröffentlichen",
      publish: "Veröffentlichen", unpublish: "Zurückziehen", noQuizzes: "Noch keine Quiz — erstelle eins.",
      pointsLabel: "Punkte", correctHint: "Tippe den Punkt für die richtige Antwort",
      needQuestion: "Füge mind. eine Frage hinzu (Text, 2+ Optionen, eine richtig).",
      done: "erledigt", questionsWord: "Fragen",
      visTitle: "Akademie-Sichtbarkeit", visManage: "Wer sie sehen darf",
      maskAll: "Akademie für alle ausblenden", maskAllSub: "Nur du + erlaubte Personen sehen den Tab.",
      visible: "Sichtbar", hidden: "Versteckt", reset: "Standard",
      staffBadge: "Team", candidateBadge: "Kandidat", searchPeople: "Personen suchen…",
    },
  };
  const L = T[lang] ?? T.en;

  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [isSupreme, setIsSupreme] = useState(false);

  const [cohorts, setCohorts] = useState<Cohort[]>([]);
  const [selId, setSelId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [activeSession, setActiveSession] = useState<{ id: string; title: string } | null>(null);
  const [marks, setMarks] = useState<Record<string, Status>>({});
  const [bonusSent, setBonusSent] = useState(false);

  const [newName, setNewName] = useState("");
  const [showNewCohort, setShowNewCohort] = useState(false);
  const [picker, setPicker] = useState<{ userId: string; name: string; photo: string | null; inCohort: boolean }[] | null>(null);
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [pq, setPq] = useState("");
  const [classTitle, setClassTitle] = useState("");
  const [classLevel, setClassLevel] = useState("A2");
  const [busy, setBusy] = useState(false);

  // quizzes + builder
  const [quizzes, setQuizzes] = useState<Quiz[]>([]);
  const [showQuiz, setShowQuiz] = useState(false);
  const [qTitle, setQTitle] = useState("");
  const [qKind, setQKind] = useState("homework");
  const [qLevel, setQLevel] = useState("A2");
  const [qPoints, setQPoints] = useState(10);
  const [qDraft, setQDraft] = useState<DraftQ[]>([{ prompt: "", options: ["", ""], correct: 0 }]);
  const [qErr, setQErr] = useState("");

  // ── Academy tab visibility (supreme only) ──────────────────────────────────
  const [maskedAll, setMaskedAll] = useState(false);
  const [visOverrides, setVisOverrides] = useState<Record<string, boolean>>({});
  const [showVis, setShowVis] = useState(false);
  const [people, setPeople] = useState<{ id: string; name: string; email: string; photo: string | null; kind: string }[]>([]);
  const [visQ, setVisQ] = useState("");

  const api = useCallback((body: object) =>
    fetch("/api/portal/academy/admin", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }), [token]);

  const loadCohorts = useCallback(async (tk: string) => {
    const r = await fetch("/api/portal/academy/admin?view=cohorts", { headers: { Authorization: `Bearer ${tk}` } });
    const j = await r.json().catch(() => ({}));
    setCohorts(j.cohorts ?? []);
    return (j.cohorts ?? []) as Cohort[];
  }, []);

  const loadVisibility = useCallback(async (tk: string) => {
    const r = await fetch("/api/portal/academy/visibility", { headers: { Authorization: `Bearer ${tk}` } });
    const j = await r.json().catch(() => ({}));
    setMaskedAll(!!j.maskedAll);
    const ov: Record<string, boolean> = {};
    for (const o of (j.overrides ?? []) as { userId: string; visible: boolean }[]) ov[o.userId] = o.visible;
    setVisOverrides(ov);
  }, []);

  const loadQuizzes = useCallback(async (id: string, tk: string) => {
    const r = await fetch(`/api/portal/academy/admin?view=quizzes&cohortId=${id}`, { headers: { Authorization: `Bearer ${tk}` } });
    const j = await r.json().catch(() => ({}));
    setQuizzes(j.quizzes ?? []);
  }, []);

  const loadCohort = useCallback(async (id: string, tk: string) => {
    const r = await fetch(`/api/portal/academy/admin?view=cohort&id=${id}`, { headers: { Authorization: `Bearer ${tk}` } });
    const j = await r.json().catch(() => ({}));
    setMembers(j.members ?? []);
    setActiveSession(j.activeSession ? { id: j.activeSession.id, title: j.activeSession.title } : null);
    setMarks(j.activeSession?.marks ?? {});
    setBonusSent(false);
    await loadQuizzes(id, tk);
  }, [loadQuizzes]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.user) { router.replace("/portal"); return; }
      const tk = session.access_token ?? "";
      const roleRes = await fetch("/api/portal/me/role", { headers: { Authorization: `Bearer ${tk}` } });
      const { role, isSuperAdmin } = await roleRes.json().catch(() => ({ role: null }));
      if (role !== "admin" && role !== "sub_admin") { router.replace("/portal"); return; }
      setIsSupreme(!!isSuperAdmin);
      setToken(tk);
      const list = await loadCohorts(tk);
      if (list[0]) { setSelId(list[0].id); await loadCohort(list[0].id, tk); }
      if (isSuperAdmin) await loadVisibility(tk);   // tab-visibility controls are supreme-only
      setLoading(false);
    });
  }, [router, loadCohorts, loadCohort, loadVisibility]);

  // ── tab-visibility handlers (supreme only) ─────────────────────────────────
  function visApi(body: object) {
    return fetch("/api/portal/academy/visibility", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }
  async function toggleMaskAll() {
    const next = !maskedAll;
    setMaskedAll(next);                              // optimistic
    await visApi({ action: "mask_all", value: next });
  }
  async function openVisibility() {
    setShowVis(true);
    if (people.length === 0) {
      const r = await fetch("/api/portal/admin/users", { headers: { Authorization: `Bearer ${token}` } });
      const j = await r.json().catch(() => ({}));
      setPeople(((j.users ?? []) as { id: string; name: string; email: string; photo: string | null; kind: string }[])
        .map(u => ({ id: u.id, name: u.name || u.email, email: u.email, photo: u.photo ?? null, kind: u.kind })));
    }
  }
  const resolvedVisible = (userId: string) => (userId in visOverrides ? visOverrides[userId] : !maskedAll);
  async function toggleUserVis(userId: string) {
    const next = !resolvedVisible(userId);
    setVisOverrides(o => ({ ...o, [userId]: next }));   // optimistic
    await visApi({ action: "set_user", userId, visible: next });
  }
  async function resetUserVis(userId: string) {
    setVisOverrides(o => { const n = { ...o }; delete n[userId]; return n; });
    await visApi({ action: "reset_user", userId });
  }

  async function selectCohort(id: string) { setSelId(id); await loadCohort(id, token); }

  async function createCohort() {
    if (!newName.trim() || busy) return;
    setBusy(true);
    const r = await api({ action: "create_cohort", name: newName.trim() });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (j.cohortId) {
      setNewName(""); setShowNewCohort(false);
      const list = await loadCohorts(token);
      const created = list.find(c => c.id === j.cohortId) ?? null;
      if (created) { setSelId(created.id); await loadCohort(created.id, token); }
    }
  }

  async function openPicker() {
    if (!selId) return;
    const r = await fetch(`/api/portal/academy/admin?view=candidates&cohortId=${selId}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    setPicker(j.candidates ?? []); setPick(new Set());
  }
  async function addPicked() {
    if (!selId || pick.size === 0 || busy) return;
    setBusy(true);
    await api({ action: "add_members", cohortId: selId, candidateIds: [...pick], level: classLevel });
    setBusy(false); setPicker(null); setPick(new Set());
    await loadCohort(selId, token); await loadCohorts(token);
  }

  async function startClass() {
    if (!selId || busy) return;
    setBusy(true);
    const title = classTitle.trim() || (lang === "de" ? "Kurs" : lang === "fr" ? "Cours" : "Class");
    const r = await api({ action: "start_session", cohortId: selId, title, level: classLevel });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (j.sessionId) { setActiveSession({ id: j.sessionId, title }); setMarks({}); setBonusSent(false); }
  }
  async function endClass() {
    if (!activeSession || busy) return;
    setBusy(true);
    await api({ action: "end_session", sessionId: activeSession.id });
    setBusy(false); setActiveSession(null); setMarks({}); setBonusSent(false);
    if (selId) await loadCohorts(token);
  }
  function mark(cid: string, s: Status) {
    if (!activeSession) return;
    const nextStatus = marks[cid] === s ? undefined : s;
    setMarks(m => ({ ...m, [cid]: nextStatus }));
    if (nextStatus) api({ action: "mark_attendance", sessionId: activeSession.id, marks: [{ candidateId: cid, status: nextStatus }] });
  }
  async function giveBonus() {
    if (!activeSession || busy) return;
    setBusy(true);
    const r = await api({ action: "class_bonus", sessionId: activeSession.id, points: 15 });
    await r.json().catch(() => ({}));
    setBusy(false); setBonusSent(true);
  }

  async function setMemberLevel(cid: string, level: string) {
    if (!selId) return;
    setMembers(ms => ms.map(m => m.candidateUserId === cid ? { ...m, level } : m)); // optimistic
    await api({ action: "set_level", cohortId: selId, candidateId: cid, level });
  }

  // ── quiz builder helpers ───────────────────────────────────────────────────
  function addQuestion() { setQDraft(d => [...d, { prompt: "", options: ["", ""], correct: 0 }]); }
  function removeQuestion(qi: number) { setQDraft(d => d.length > 1 ? d.filter((_, i) => i !== qi) : d); }
  function setPrompt(qi: number, v: string) { setQDraft(d => d.map((q, i) => i === qi ? { ...q, prompt: v } : q)); }
  function setOption(qi: number, oi: number, v: string) { setQDraft(d => d.map((q, i) => i === qi ? { ...q, options: q.options.map((o, j) => j === oi ? v : o) } : q)); }
  function addOption(qi: number) { setQDraft(d => d.map((q, i) => i === qi && q.options.length < 6 ? { ...q, options: [...q.options, ""] } : q)); }
  function removeOption(qi: number, oi: number) {
    setQDraft(d => d.map((q, i) => {
      if (i !== qi || q.options.length <= 2) return q;
      const options = q.options.filter((_, j) => j !== oi);
      const correct = q.correct >= options.length ? options.length - 1 : q.correct;
      return { ...q, options, correct };
    }));
  }
  function markCorrect(qi: number, oi: number) { setQDraft(d => d.map((q, i) => i === qi ? { ...q, correct: oi } : q)); }
  function resetQuizForm() { setQTitle(""); setQKind("homework"); setQLevel("A2"); setQPoints(10); setQDraft([{ prompt: "", options: ["", ""], correct: 0 }]); setQErr(""); }

  async function createQuiz() {
    if (!selId || busy) return;
    const questions = qDraft
      .map(q => ({ prompt: q.prompt.trim(), options: q.options.map(o => o.trim()).filter(Boolean), correct: q.correct }))
      .filter(q => q.prompt && q.options.length >= 2 && q.correct < q.options.length);
    if (!qTitle.trim() || questions.length === 0) { setQErr(L.needQuestion); return; }
    setBusy(true); setQErr("");
    const r = await api({ action: "create_quiz", cohortId: selId, title: qTitle.trim(), kind: qKind, level: qLevel, pointsAward: qPoints, questions, published: true });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (j.quizId) { setShowQuiz(false); resetQuizForm(); await loadQuizzes(selId, token); }
    else setQErr(j.error ?? "Error");
  }

  async function togglePublish(quizId: string) {
    setQuizzes(qs => qs.map(q => q.id === quizId ? { ...q, published: !q.published } : q)); // optimistic
    await api({ action: "toggle_quiz", quizId });
  }

  const presentCount = members.filter(m => marks[m.candidateUserId] === "present").length;
  const lateCount = members.filter(m => marks[m.candidateUserId] === "late").length;
  const absentCount = members.filter(m => marks[m.candidateUserId] === "absent").length;
  const rewardable = presentCount + lateCount;
  const selected = cohorts.find(c => c.id === selId) ?? null;

  const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 20 };
  const av = (name: string, photo: string | null): React.CSSProperties => ({
    width: 38, height: 38, borderRadius: 99, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 14, fontWeight: 700, background: photo ? `center/cover no-repeat url(${photo})` : "var(--bg2)",
    color: "var(--w2)", border: "1px solid var(--border)",
  });
  const pill = (active: boolean, color: string): React.CSSProperties => ({
    width: 38, height: 34, borderRadius: 10, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer", border: `1.5px solid ${active ? color : "var(--border)"}`, background: active ? color : "transparent",
    color: active ? "#fff" : "var(--w3)",
  });

  if (loading) return <PageLoader />;

  return (
    <main id="bv-main" tabIndex={-1} className="bv-page-bottom min-h-screen" style={{ background: "var(--bg)", paddingTop: "58px" }}>
      <PortalTopNav />
      <div className="max-w-[680px] mx-auto px-4 pt-8 pb-20">

        {/* header */}
        <div className="flex items-center gap-3 mb-5">
          <button onClick={() => router.push("/portal/admin")} aria-label="Back"
            className="bv-icon-btn w-9 h-9 flex items-center justify-center flex-shrink-0 rounded-full" style={{ color: "var(--w2)" }}>
            <ArrowLeft size={15} strokeWidth={1.8} />
          </button>
          <div className="flex-1">
            <h1 className="text-[20px] font-semibold tracking-[-0.015em]" style={{ color: "var(--w)" }}>{L.title}</h1>
            <p className="text-[12.5px] mt-1" style={{ color: "var(--w3)" }}>{L.desc}</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mb-4 text-[12px] font-semibold" style={{ color: "var(--w3)" }}>
          <Users size={14} strokeWidth={2} />{isSupreme ? L.scopeAll : L.scopeOrg}
        </div>

        {/* ── VISIBILITY (supreme only) — hide the WIP Academy tab ─────────── */}
        {isSupreme && (
          <div className="p-4 mb-5" style={{ ...card, borderColor: "var(--border-gold)" }}>
            <div className="flex items-center gap-1.5 mb-3">
              <Eye size={14} strokeWidth={2.2} style={{ color: "var(--w3)" }} />
              <span className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--w3)" }}>{L.visTitle}</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <div className="text-[14px] font-bold" style={{ color: "var(--w)" }}>{L.maskAll}</div>
                <div className="text-[12px] mt-0.5" style={{ color: "var(--w3)" }}>{L.maskAllSub}</div>
              </div>
              {/* switch — gold when masked (hidden from all) */}
              <button onClick={toggleMaskAll} role="switch" aria-checked={maskedAll} aria-label={L.maskAll}
                className="relative flex-shrink-0" style={{
                  width: 48, height: 28, borderRadius: 99, cursor: "pointer", border: "none",
                  background: maskedAll ? "var(--gold)" : "var(--bg2)", transition: "background .2s",
                }}>
                <span style={{
                  position: "absolute", top: 3, left: maskedAll ? 23 : 3, width: 22, height: 22, borderRadius: 99,
                  background: maskedAll ? "#131312" : "var(--w3)", transition: "left .2s",
                }} />
              </button>
            </div>
            <button onClick={openVisibility} className="mt-3 flex items-center gap-1.5 text-[13px] font-bold px-3 py-2 rounded-full"
              style={{ background: "var(--gdim)", color: "var(--gold)", border: "none", cursor: "pointer" }}>
              <Users size={14} strokeWidth={2.4} />{L.visManage}
            </button>
          </div>
        )}

        {/* cohort selector */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-[15px] font-extrabold" style={{ color: "var(--w)" }}>{L.cohorts}</span>
          <button onClick={() => setShowNewCohort(s => !s)} className="flex items-center gap-1 text-[13px] font-bold px-3 py-1.5 rounded-full"
            style={{ background: "var(--gdim)", color: "var(--gold)", border: "none", cursor: "pointer" }}>
            <Plus size={15} strokeWidth={2.6} />{L.newCohort}
          </button>
        </div>

        {showNewCohort && (
          <div className="p-4 mb-3 flex gap-2" style={card}>
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder={L.cohortName}
              className="flex-1 px-3 py-2.5 rounded-xl text-[14px]" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" }} />
            <button onClick={createCohort} disabled={busy || !newName.trim()}
              className="px-4 py-2.5 rounded-xl text-[14px] font-extrabold" style={{ background: "var(--gold)", color: "#131312", border: "none", cursor: "pointer", opacity: busy || !newName.trim() ? 0.5 : 1 }}>
              {L.create}
            </button>
          </div>
        )}

        {cohorts.length === 0 ? (
          <div className="p-6 mb-6 text-center text-[13px]" style={{ ...card, color: "var(--w3)" }}>{L.noCohorts}</div>
        ) : (
          <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
            {cohorts.map(c => (
              <button key={c.id} onClick={() => selectCohort(c.id)}
                className="flex-shrink-0 px-4 py-2.5 rounded-xl text-left" style={{
                  background: c.id === selId ? "var(--gdim)" : "var(--card)",
                  border: `1px solid ${c.id === selId ? "var(--border-gold)" : "var(--border)"}`, cursor: "pointer",
                }}>
                <div className="text-[14px] font-bold" style={{ color: c.id === selId ? "var(--gold)" : "var(--w)" }}>{c.name}</div>
                <div className="text-[11px]" style={{ color: "var(--w3)" }}>{c.memberCount} {L.members}{c.activeSession ? " · 🔴" : ""}</div>
              </button>
            ))}
          </div>
        )}

        {selected && (
          <>
            {/* class card — start / live roster / bonus */}
            <div className="p-5 mb-6" style={{ ...card, borderColor: "var(--border-gold)" }}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-[16px] font-extrabold" style={{ color: "var(--w)" }}>{selected.name}</span>
                {activeSession && (
                  <span className="flex items-center gap-1 text-[11px] font-extrabold px-2 py-0.5 rounded-full" style={{ background: "#ef4444", color: "#fff" }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: "#fff" }} />{L.live}
                  </span>
                )}
              </div>

              {!activeSession ? (
                <>
                  <div className="flex gap-2 mb-3">
                    <input value={classTitle} onChange={e => setClassTitle(e.target.value)} placeholder={L.classTitle}
                      className="flex-1 px-3 py-2.5 rounded-xl text-[14px]" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" }} />
                    <select value={classLevel} onChange={e => setClassLevel(e.target.value)} className="px-3 py-2.5 rounded-xl text-[14px]"
                      style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" }}>
                      {LEVELS.map(l => <option key={l}>{l}</option>)}
                    </select>
                  </div>
                  <button onClick={startClass} disabled={busy || members.length === 0}
                    className="w-full py-4 rounded-2xl flex items-center justify-center gap-2 text-[16px] font-extrabold"
                    style={{ background: members.length === 0 ? "var(--bg2)" : "var(--gold)", color: members.length === 0 ? "var(--w3)" : "#131312", border: "none", cursor: members.length === 0 ? "not-allowed" : "pointer" }}>
                    <Play size={20} strokeWidth={2.2} fill={members.length === 0 ? "var(--w3)" : "#131312"} />{L.startClass}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex gap-2 mb-4">
                    {[["#16a34a", presentCount, L.present], ["#f59e0b", lateCount, L.late], ["#ef4444", absentCount, L.absent]].map(([c, n, lbl], i) => (
                      <div key={i} className="flex-1 py-2 rounded-xl text-center" style={{ background: `${c as string}20` }}>
                        <div className="text-[18px] font-extrabold leading-none" style={{ color: c as string }}>{n as number}</div>
                        <div className="text-[10px] mt-1" style={{ color: "var(--w3)" }}>{lbl as string}</div>
                      </div>
                    ))}
                  </div>

                  <div className="text-[11px] font-semibold mb-2" style={{ color: "var(--w3)" }}>{L.markEach}</div>
                  <div className="flex flex-col gap-2 mb-4">
                    {members.map(m => (
                      <div key={m.candidateUserId} className="flex items-center gap-3 py-1.5 px-2 rounded-xl" style={{ background: "var(--bg2)" }}>
                        <span style={av(m.name, m.photo)}>{!m.photo && (m.name.charAt(0) || "?")}</span>
                        <span className="flex-1 text-[14px] font-semibold" style={{ color: "var(--w)" }}>{m.name}</span>
                        <div className="flex gap-1.5">
                          <button onClick={() => mark(m.candidateUserId, "present")} style={pill(marks[m.candidateUserId] === "present", "#16a34a")}><Check size={16} strokeWidth={2.6} /></button>
                          <button onClick={() => mark(m.candidateUserId, "late")} style={pill(marks[m.candidateUserId] === "late", "#f59e0b")}><Clock size={15} strokeWidth={2.4} /></button>
                          <button onClick={() => mark(m.candidateUserId, "absent")} style={pill(marks[m.candidateUserId] === "absent", "#ef4444")}><X size={16} strokeWidth={2.6} /></button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {!bonusSent ? (
                    <button onClick={giveBonus} disabled={rewardable === 0 || busy}
                      className="w-full py-4 rounded-2xl flex items-center justify-center gap-2 text-[16px] font-extrabold mb-2"
                      style={{ background: rewardable === 0 ? "var(--bg2)" : "var(--gold)", color: rewardable === 0 ? "var(--w3)" : "#131312", border: "none", cursor: rewardable === 0 ? "not-allowed" : "pointer" }}>
                      <Gift size={20} strokeWidth={2.2} />{L.giveBonus} +15
                    </button>
                  ) : (
                    <div className="w-full py-3.5 rounded-2xl flex items-center justify-center gap-2 text-[14px] font-bold mb-2" style={{ background: "rgba(22,163,74,0.14)", color: "#16a34a" }}>
                      <Check size={18} strokeWidth={2.6} />{L.bonusToAll(rewardable)}
                    </div>
                  )}
                  <button onClick={endClass} disabled={busy} className="w-full py-3 rounded-2xl flex items-center justify-center gap-2 text-[13px] font-semibold"
                    style={{ background: "transparent", color: "var(--w3)", border: "1px solid var(--border)", cursor: "pointer" }}>
                    <Square size={13} strokeWidth={2.4} />{L.endClass}
                  </button>
                </>
              )}
            </div>

            {/* members + add */}
            {!activeSession && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[15px] font-extrabold" style={{ color: "var(--w)" }}>{members.length} {L.members}</span>
                  <button onClick={openPicker} className="flex items-center gap-1 text-[13px] font-bold px-3 py-1.5 rounded-full"
                    style={{ background: "var(--gdim)", color: "var(--gold)", border: "none", cursor: "pointer" }}>
                    <Plus size={15} strokeWidth={2.6} />{L.addStudents}
                  </button>
                </div>
                {members.length === 0 ? (
                  <div className="p-5 text-center text-[13px]" style={{ ...card, color: "var(--w3)" }}>{L.noMembers}</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {members.map(m => (
                      <div key={m.candidateUserId} className="flex items-center gap-3 p-3" style={card}>
                        <span style={av(m.name, m.photo)}>{!m.photo && (m.name.charAt(0) || "?")}</span>
                        <span className="flex-1 text-[14px] font-bold" style={{ color: "var(--w)" }}>{m.name}</span>
                        {/* live CEFR level — climbing fires level_up +50 */}
                        <select value={m.level} onChange={e => setMemberLevel(m.candidateUserId, e.target.value)}
                          aria-label={L.level}
                          className="text-[12px] font-bold px-2 py-1 rounded-full cursor-pointer"
                          style={{ background: "var(--gdim)", color: "var(--gold)", border: "none" }}>
                          {LEVELS.map(l => <option key={l} value={l} style={{ background: "var(--card)", color: "var(--w)" }}>{l}</option>)}
                        </select>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Quizzes & homework ─────────────────────────────────────── */}
                <div className="flex items-center justify-between mt-6 mb-3">
                  <span className="text-[15px] font-extrabold flex items-center gap-2" style={{ color: "var(--w)" }}>
                    <ClipboardList size={17} strokeWidth={2} />{L.quizzes}
                  </span>
                  <button onClick={() => { resetQuizForm(); setShowQuiz(true); }} className="flex items-center gap-1 text-[13px] font-bold px-3 py-1.5 rounded-full"
                    style={{ background: "var(--gdim)", color: "var(--gold)", border: "none", cursor: "pointer" }}>
                    <Plus size={15} strokeWidth={2.6} />{L.newQuiz}
                  </button>
                </div>
                {quizzes.length === 0 ? (
                  <div className="p-5 text-center text-[13px]" style={{ ...card, color: "var(--w3)" }}>{L.noQuizzes}</div>
                ) : (
                  <div className="flex flex-col gap-2">
                    {quizzes.map(qz => (
                      <div key={qz.id} className="flex items-center gap-3 p-3" style={card}>
                        <span className="flex-1">
                          <span className="block text-[14px] font-bold" style={{ color: "var(--w)" }}>{qz.title}</span>
                          <span className="block text-[11px]" style={{ color: "var(--w3)" }}>
                            {qz.level} · {qz.questionCount} {L.questionsWord} · {qz.submissions} {L.done}
                          </span>
                        </span>
                        <button onClick={() => togglePublish(qz.id)} className="text-[11px] font-bold px-2.5 py-1 rounded-full"
                          style={{ background: qz.published ? "rgba(22,163,74,0.14)" : "var(--bg2)", color: qz.published ? "#16a34a" : "var(--w3)", border: "none", cursor: "pointer" }}>
                          {qz.published ? L.unpublish : L.publish}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ── Quiz builder overlay ─────────────────────────────────────────────── */}
      {showQuiz && (
        <div className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }} onClick={() => setShowQuiz(false)}>
          <div className="w-full sm:max-w-[520px] max-h-[88vh] flex flex-col" style={{ background: "var(--card)", borderRadius: 20, border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
            <div className="p-4 flex items-center justify-between" style={{ borderBottom: "1px solid var(--border)" }}>
              <span className="text-[16px] font-extrabold" style={{ color: "var(--w)" }}>{L.newQuiz}</span>
              <button onClick={() => setShowQuiz(false)} style={{ color: "var(--w3)", background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {/* meta */}
              <input value={qTitle} onChange={e => setQTitle(e.target.value)} placeholder={L.quizTitle}
                className="px-3 py-2.5 rounded-xl text-[14px]" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" }} />
              <div className="flex gap-2">
                <select value={qKind} onChange={e => setQKind(e.target.value)} className="flex-1 px-3 py-2.5 rounded-xl text-[14px]" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" }}>
                  <option value="homework">{L.kHomework}</option>
                  <option value="quiz">{L.kQuiz}</option>
                  <option value="mock_exam">{L.kExam}</option>
                </select>
                <select value={qLevel} onChange={e => setQLevel(e.target.value)} className="px-3 py-2.5 rounded-xl text-[14px]" style={{ background: "var(--bg2)", border: "1px solid var(--border)", color: "var(--w)" }}>
                  {LEVELS.map(l => <option key={l}>{l}</option>)}
                </select>
                <div className="flex items-center gap-1.5 px-3 py-2.5 rounded-xl" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                  <span className="text-[12px]" style={{ color: "var(--w3)" }}>{L.pointsLabel}</span>
                  <input type="number" value={qPoints} onChange={e => setQPoints(Math.max(0, Number(e.target.value)))} className="w-12 bg-transparent text-[14px] font-bold" style={{ color: "var(--w)", outline: "none", border: "none" }} />
                </div>
              </div>

              <div className="text-[11px]" style={{ color: "var(--w3)" }}>{L.correctHint}</div>

              {/* questions */}
              {qDraft.map((q, qi) => (
                <div key={qi} className="p-3 rounded-2xl flex flex-col gap-2" style={{ background: "var(--bg2)", border: "1px solid var(--border)" }}>
                  <div className="flex items-center gap-2">
                    <span className="text-[12px] font-extrabold" style={{ color: "var(--gold)" }}>{qi + 1}</span>
                    <input value={q.prompt} onChange={e => setPrompt(qi, e.target.value)} placeholder={L.questionPrompt}
                      className="flex-1 px-3 py-2 rounded-lg text-[14px]" style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--w)" }} />
                    {qDraft.length > 1 && (
                      <button onClick={() => removeQuestion(qi)} style={{ color: "var(--w3)", background: "none", border: "none", cursor: "pointer" }}><Trash2 size={15} /></button>
                    )}
                  </div>
                  {q.options.map((o, oi) => (
                    <div key={oi} className="flex items-center gap-2 pl-5">
                      {/* correct-answer dot */}
                      <button onClick={() => markCorrect(qi, oi)} aria-label="correct" className="flex items-center justify-center rounded-full flex-shrink-0"
                        style={{ width: 20, height: 20, border: `2px solid ${q.correct === oi ? "#16a34a" : "var(--border)"}`, background: q.correct === oi ? "#16a34a" : "transparent", cursor: "pointer" }}>
                        {q.correct === oi && <Check size={12} strokeWidth={3} style={{ color: "#fff" }} />}
                      </button>
                      <input value={o} onChange={e => setOption(qi, oi, e.target.value)} placeholder={`${L.option} ${oi + 1}`}
                        className="flex-1 px-3 py-2 rounded-lg text-[13px]" style={{ background: "var(--card)", border: "1px solid var(--border)", color: "var(--w)" }} />
                      {q.options.length > 2 && (
                        <button onClick={() => removeOption(qi, oi)} style={{ color: "var(--w3)", background: "none", border: "none", cursor: "pointer" }}><X size={14} /></button>
                      )}
                    </div>
                  ))}
                  {q.options.length < 6 && (
                    <button onClick={() => addOption(qi)} className="self-start text-[12px] font-semibold pl-5 flex items-center gap-1" style={{ color: "var(--w3)", background: "none", border: "none", cursor: "pointer" }}>
                      <Plus size={13} strokeWidth={2.4} />{L.option}
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addQuestion} className="py-2.5 rounded-xl text-[13px] font-bold flex items-center justify-center gap-1.5" style={{ background: "var(--bg2)", color: "var(--w2)", border: "1px dashed var(--border)", cursor: "pointer" }}>
                <Plus size={15} strokeWidth={2.4} />{L.addQuestion}
              </button>

              {qErr && <div className="text-[12px] px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444" }}>{qErr}</div>}
            </div>
            <div className="p-3" style={{ borderTop: "1px solid var(--border)" }}>
              <button onClick={createQuiz} disabled={busy}
                className="w-full py-3 rounded-xl text-[15px] font-extrabold" style={{ background: "var(--gold)", color: "#131312", border: "none", cursor: "pointer", opacity: busy ? 0.6 : 1 }}>
                {L.saveQuiz}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* picker overlay */}
      {picker && (
        <div className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }} onClick={() => setPicker(null)}>
          <div className="w-full sm:max-w-[460px] max-h-[80vh] flex flex-col" style={{ background: "var(--card)", borderRadius: 20, border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
            <div className="p-4 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
              <Search size={16} style={{ color: "var(--w3)" }} />
              <input value={pq} onChange={e => setPq(e.target.value)} placeholder={L.search} autoFocus
                className="flex-1 bg-transparent text-[14px]" style={{ color: "var(--w)", outline: "none", border: "none" }} />
              <button onClick={() => setPicker(null)} style={{ color: "var(--w3)", background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {picker.filter(c => !c.inCohort && c.name.toLowerCase().includes(pq.toLowerCase())).map(c => {
                const on = pick.has(c.userId);
                return (
                  <button key={c.userId} onClick={() => setPick(s => { const n = new Set(s); on ? n.delete(c.userId) : n.add(c.userId); return n; })}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl text-left" style={{ background: on ? "var(--gdim)" : "transparent", cursor: "pointer" }}>
                    <span style={av(c.name, c.photo)}>{!c.photo && (c.name.charAt(0) || "?")}</span>
                    <span className="flex-1 text-[14px] font-semibold" style={{ color: "var(--w)" }}>{c.name}</span>
                    <span className="flex items-center justify-center rounded-full" style={{ width: 22, height: 22, border: `2px solid ${on ? "var(--gold)" : "var(--border)"}`, background: on ? "var(--gold)" : "transparent" }}>
                      {on && <Check size={13} strokeWidth={3} style={{ color: "#131312" }} />}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="p-3" style={{ borderTop: "1px solid var(--border)" }}>
              <button onClick={addPicked} disabled={pick.size === 0 || busy}
                className="w-full py-3 rounded-xl text-[15px] font-extrabold" style={{ background: pick.size === 0 ? "var(--bg2)" : "var(--gold)", color: pick.size === 0 ? "var(--w3)" : "#131312", border: "none", cursor: pick.size === 0 ? "not-allowed" : "pointer" }}>
                {L.add} {pick.size > 0 ? `(${pick.size} ${L.selected})` : ""}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── visibility people modal (supreme only) ──────────────────────────── */}
      {showVis && (
        <div className="fixed inset-0 z-[1100] flex items-end sm:items-center justify-center" style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(8px)" }} onClick={() => setShowVis(false)}>
          <div className="w-full sm:max-w-[480px] max-h-[82vh] flex flex-col" style={{ background: "var(--card)", borderRadius: 20, border: "1px solid var(--border)" }} onClick={e => e.stopPropagation()}>
            <div className="p-4 flex items-center gap-2" style={{ borderBottom: "1px solid var(--border)" }}>
              <Search size={16} style={{ color: "var(--w3)" }} />
              <input value={visQ} onChange={e => setVisQ(e.target.value)} placeholder={L.searchPeople} autoFocus
                className="flex-1 bg-transparent text-[14px]" style={{ color: "var(--w)", outline: "none", border: "none" }} />
              <button onClick={() => setShowVis(false)} style={{ color: "var(--w3)", background: "none", border: "none", cursor: "pointer" }}><X size={18} /></button>
            </div>
            <div className="px-4 pt-3 pb-1 text-[12px]" style={{ color: "var(--w3)" }}>
              {maskedAll ? L.maskAll : L.visManage}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {people
                .filter(p => p.name.toLowerCase().includes(visQ.toLowerCase()) || p.email.toLowerCase().includes(visQ.toLowerCase()))
                .map(p => {
                  const vis = resolvedVisible(p.id);
                  const hasOverride = p.id in visOverrides;
                  return (
                    <div key={p.id} className="w-full flex items-center gap-3 p-2.5 rounded-xl" style={{ background: "transparent" }}>
                      <span style={av(p.name, p.photo)}>{!p.photo && (p.name.charAt(0) || "?")}</span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-semibold truncate" style={{ color: "var(--w)" }}>{p.name}</span>
                        <span className="block text-[11px]" style={{ color: "var(--w3)" }}>{p.kind === "candidate" ? L.candidateBadge : L.staffBadge}</span>
                      </span>
                      {hasOverride && (
                        <button onClick={() => resetUserVis(p.id)} className="text-[11px] font-semibold px-2 py-1 rounded-full"
                          style={{ background: "var(--bg2)", color: "var(--w3)", border: "none", cursor: "pointer" }}>{L.reset}</button>
                      )}
                      <button onClick={() => toggleUserVis(p.id)} aria-label={vis ? L.visible : L.hidden}
                        className="flex items-center gap-1.5 text-[12px] font-bold px-2.5 py-1.5 rounded-full flex-shrink-0"
                        style={{ background: vis ? "rgba(22,163,74,0.14)" : "rgba(239,68,68,0.12)", color: vis ? "#16a34a" : "#ef4444", border: "none", cursor: "pointer" }}>
                        {vis ? <Eye size={14} strokeWidth={2.2} /> : <EyeOff size={14} strokeWidth={2.2} />}
                        {vis ? L.visible : L.hidden}
                      </button>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
