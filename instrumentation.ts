import { assertProductionEnv } from "@/lib/env";

export function register() {
  assertProductionEnv();
}
