import { ConvexHttpClient } from "convex/browser";

// Newer Convex CLI versions write only VITE_CONVEX_URL into .env.local
// (no CONVEX_URL). Both names point to the same deployment URL, so we
// accept either and fall back gracefully.
const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
if (!url) {
  throw new Error(
    "CONVEX_URL / VITE_CONVEX_URL is not set. Run `npm run setup` or `npx convex dev` to configure Convex.",
  );
}

export const convex = new ConvexHttpClient(url);
