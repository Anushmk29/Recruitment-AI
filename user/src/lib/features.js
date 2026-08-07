/**
 * Frontend feature switches for the candidate app.
 *
 * A switch here hides a surface that is BUILT and working. That is the only
 * thing it is for: a product decision about what a candidate should be asked to
 * deal with today. It is NOT a stub, a fallback, or a degraded path, so nothing
 * gated here needs the "this reading is degraded" labelling the scoring
 * surfaces carry — a hidden feature makes no claim at all, which is exactly why
 * hiding is safe and a placeholder would not be.
 *
 * Vite inlines `import.meta.env` at build time, so these are deploy-time
 * switches. Flip one by setting the var in `user/.env` and rebuilding.
 */

/**
 * Phone-as-second-camera QR pairing (Phase 14.6) — the pre-check pairing card
 * and the `/phone-cam/:token` companion page.
 *
 * Shelved from the candidate UI. It asks someone minutes away from an interview
 * to pick up a second device and scan a code, and the integrity signal that
 * buys is not one the report acts on yet — so the cost lands entirely on the
 * candidate and the benefit lands nowhere.
 *
 * The backend is untouched and keeps its own gate (`SECONDARY_CAM_ENABLED`, or
 * `CompanySettings.proctoring.secondaryCam` per tenant, both default OFF). This
 * switch sits IN FRONT of that one rather than replacing it, so the surface
 * stays hidden even where a deployed env or a tenant override has turned the
 * server side on. Both must be on for the pairing card to appear again.
 */
export const PHONE_PAIRING_ENABLED = import.meta.env.VITE_PHONE_PAIRING_ENABLED === "true";
