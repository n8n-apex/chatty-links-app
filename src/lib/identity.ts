/**
 * Single source of truth for the learner identity.
 *
 * The app has no session. The identity is whatever LearningSuite puts in the
 * iframe URL. In production an absent parameter yields an EMPTY identity, so
 * anonymous visitors do not all land in one shared history bucket.
 */
export const getUserEmail = (): string => {
  if (typeof window === "undefined") return import.meta.env.DEV ? "preview@test.com" : "";
  const emailFromUrl = new URLSearchParams(window.location.search).get("email");
  return emailFromUrl?.trim() || (import.meta.env.DEV ? "preview@test.com" : "");
};
