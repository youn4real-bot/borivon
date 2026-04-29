/**
 * Design tokens — fluid sizing & shape values used across the funnel
 * card and any future B2C card-style flows.
 *
 * Each token is a `clamp(min, vw, max)` so it scales between ~320px and
 * ~520px viewports. Names are semantic (purpose-led, not value-led) so
 * future tweaks happen here once instead of across every component.
 *
 * Conventions:
 *   FS_*  — font sizes
 *   SP_*  — spacing (gap / margin / single-axis padding)
 *   PAD_* — composite padding shorthand
 *   FX_*  — visual effects (radii, etc.)
 */

// ── Font sizes ────────────────────────────────────────────────────────
export const FS_EYEBROW    = "clamp(0.55rem,1.2vw,0.6rem)";   // gold uppercase eyebrow
export const FS_NOTE       = "clamp(0.56rem,1.4vw,0.62rem)";  // privacy / fine print
export const FS_BACK       = "clamp(0.7rem,1.8vw,0.78rem)";   // back-button label
export const FS_SUMMARY    = "clamp(0.75rem,1.7vw,0.79rem)";  // summary badge body
export const FS_DESC       = "clamp(0.75rem,1.8vw,0.8rem)";   // step description paragraph
export const FS_INPUT      = "clamp(0.82rem,2vw,0.86rem)";    // input/textarea text
export const FS_LEVEL_NAME = "clamp(0.65rem,1.5vw,0.7rem)";   // A1/A2 level subtitle
export const FS_BTN        = "clamp(0.86rem,2.1vw,0.91rem)";  // primary CTA label
export const FS_CHOICE     = "clamp(0.86rem,2.2vw,0.92rem)";  // choice-row label
export const FS_TITLE      = "clamp(1.15rem,3vw,1.45rem)";    // step title
export const FS_TITLE_SM   = "clamp(1.1rem,2.8vw,1.35rem)";   // tighter step title (portal CTA)
export const FS_LEVEL_CODE = "clamp(1.35rem,3.6vw,1.6rem)";   // A1/A2 big code

// ── Spacing ───────────────────────────────────────────────────────────
export const SP_INPUT_MB   = "clamp(0.38rem,1vw,0.44rem)";    // gap between inputs
export const SP_CHOICE_GAP = "clamp(0.38rem,1.1vw,0.48rem)";  // gap between choice rows
export const SP_EYEBROW_MB = "clamp(0.45rem,1.4vw,0.62rem)";  // eyebrow → title
export const SP_TITLE_MB   = "clamp(0.65rem,2vw,0.85rem)";    // title → body
export const SP_SUMMARY_MB = "clamp(0.7rem,2.2vw,0.9rem)";    // summary badge → fields

// ── Padding ───────────────────────────────────────────────────────────
export const PAD_INPUT     = "clamp(0.62rem,1.6vw,0.7rem) clamp(0.82rem,2.2vw,0.92rem)";
export const PAD_CHOICE    = "clamp(0.58rem,1.6vw,0.7rem) clamp(0.8rem,2.2vw,0.95rem)";
export const PAD_BTN       = "clamp(0.68rem,2vw,0.76rem)";
export const PAD_CARD      = "clamp(1.05rem,3.5vw,1.7rem)";
export const PAD_SUMMARY   = "clamp(0.5rem,1.4vw,0.58rem) clamp(0.7rem,2vw,0.82rem)";

// ── Shape ─────────────────────────────────────────────────────────────
export const FX_CARD_RADIUS  = "clamp(12px,2.8vw,18px)";
export const FX_FIELD_RADIUS = "9px";
export const FX_BTN_RADIUS   = "14px";

// ── Card ──────────────────────────────────────────────────────────────
export const CARD_MAX_WIDTH = "min(430px, 88vw)";
