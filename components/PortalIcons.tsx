/**
 * Centralized Lucide icon mapping for the portal.
 *
 * Replaces ad-hoc emoji prefixes (🪪 🏥 ✍️ 📝 🎤 📋 🏛️ ✈️ 🛫 🛂 …) with
 * consistent line icons. Two helpers:
 *
 *   <PhaseIcon kind="passport" size={16} />     → wizard / journey phase icons
 *   <SectionIcon kind="photo" size={18} />      → CV-builder section card icons
 *
 * Why a wrapper instead of importing Lucide everywhere?
 *   - one place to swap an icon brand-wide
 *   - one place to enforce stroke width / size rhythm
 *   - keeps page files focused on layout, not icon plumbing
 */

import {
  // Document / phase icons
  IdCard,           // ID & passport bundle (was 🪪)
  Stethoscope,      // Nursing (was 🏥) — could swap for HeartPulse if preferred
  Languages,        // Translations (was ✍️)
  FileText,         // Other docs (was 📝)
  // Journey icons
  Mic2,             // Interview (was 🎤)
  ClipboardList,    // Recognition (was 📋)
  Landmark,         // Embassy (was 🏛️)
  Plane,            // Visa (was ✈️)
  PlaneTakeoff,     // Flight (was 🛫)
  // Misc UI / states
  Lock, Unlock,     // 🔒 / 🔓
  Camera,           // 📷
  User,             // 👤
  Home,             // 🏠
  GraduationCap,    // 🎓
  Globe,            // 🌍
  Laptop,           // 💻
  PartyPopper,      // 🎉
  Mail,             // 📩
  Calendar,         // 📅
  ExternalLink,     // 🔗
  Folder,           // 📁
  FilePen,          // ✏️
  AlertTriangle,    // ⚠️
  BookOpen,         // 📚
  School,           // 🏫
  Bell,             // 🔔
  Save,             // 💾
  Sparkles,         // ✨
  Eye,              // 👁
  CheckCircle2,     // ✅
  XCircle,          // ❌
  Paperclip,        // 📎
  Briefcase,        // for professional / work
  Wallet,           // could be useful
} from "lucide-react";

import type { LucideIcon } from "lucide-react";

// ── Phase / wizard kinds ─────────────────────────────────────────────────────
export type PhaseKind =
  | "id" | "passport" | "nursing" | "translations" | "others"
  | "docs" | "interview" | "recognition" | "embassy" | "visa" | "flight";

const PHASE_ICONS: Record<PhaseKind, LucideIcon> = {
  id:           IdCard,
  passport:     IdCard,
  nursing:      Stethoscope,
  translations: Languages,
  others:       FileText,
  docs:         Folder,
  interview:    Mic2,
  recognition:  ClipboardList,
  embassy:      Landmark,
  visa:         Plane,
  flight:       PlaneTakeoff,
};

// ── CV-builder section kinds ────────────────────────────────────────────────
export type SectionKind =
  | "photo" | "personal" | "work" | "education" | "languages" | "skills" | "other"
  | "abitur" | "nursing-edu" | "other-edu";

const SECTION_ICONS: Record<SectionKind, LucideIcon> = {
  photo:        Camera,
  personal:     User,
  work:         Stethoscope,        // healthcare CVs — feels appropriate
  education:    GraduationCap,
  languages:    Globe,
  skills:       Laptop,
  other:        ClipboardList,
  abitur:       School,
  "nursing-edu":Stethoscope,
  "other-edu":  BookOpen,
};

// Common stroke + sizing for visual consistency
const DEFAULT_STROKE = 1.6;

export function PhaseIcon({
  kind, size = 16, className = "", strokeWidth = DEFAULT_STROKE, style,
}: {
  kind: PhaseKind;
  size?: number;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}) {
  const Cmp = PHASE_ICONS[kind];
  return <Cmp size={size} strokeWidth={strokeWidth} className={className} style={style} aria-hidden="true" />;
}

export function SectionIcon({
  kind, size = 18, className = "", strokeWidth = DEFAULT_STROKE, style,
}: {
  kind: SectionKind;
  size?: number;
  className?: string;
  strokeWidth?: number;
  style?: React.CSSProperties;
}) {
  const Cmp = SECTION_ICONS[kind];
  return <Cmp size={size} strokeWidth={strokeWidth} className={className} style={style} aria-hidden="true" />;
}

// ── Re-exports for direct use in pages where a one-off icon is clearer ──────
export {
  Lock, Unlock, Mail, Calendar, ExternalLink, Folder, FilePen, AlertTriangle,
  PartyPopper, Bell, Save, Sparkles, Eye, CheckCircle2, XCircle, Paperclip,
  User, Home, IdCard, Camera, Languages, Mic2, ClipboardList, Landmark, Plane,
  PlaneTakeoff, Stethoscope, GraduationCap, Globe, Laptop, BookOpen, School,
  FileText, Briefcase, Wallet,
};
