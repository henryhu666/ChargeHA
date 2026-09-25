import type { createAppRouter } from "../../../server/src/trpc/root.ts";
import type { createSungrowRouter } from "./server/router.ts";

export type SungrowAppRouter = ReturnType<
  typeof createAppRouter<
    Record<string, never>,
    { sungrow_isolarcloud: ReturnType<typeof createSungrowRouter> },
    Record<string, never>
  >
>;
