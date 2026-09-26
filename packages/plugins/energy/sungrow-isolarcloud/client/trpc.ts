import { widenTrpc } from "../../../hostUi.ts";
import type { SungrowAppRouter } from "../routerType.ts";

export const trpc = widenTrpc<SungrowAppRouter>();
