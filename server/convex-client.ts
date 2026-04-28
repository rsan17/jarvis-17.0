import { ConvexHttpClient } from "convex/browser";

// Newer Convex CLI versions write only `VITE_CONVEX_URL` to .env.local
// (the `CONVEX_URL` line is gone). Fall back to it so the server boots on
// fresh installs without forcing the user to duplicate the var by hand.
const url = process.env.CONVEX_URL ?? process.env.VITE_CONVEX_URL;
if (!url) {
  throw new Error(
    "CONVEX_URL / VITE_CONVEX_URL is not set. Run `npm run setup` or `npx convex dev` to configure Convex.",
  );
}

export const convex = new ConvexHttpClient(url);
