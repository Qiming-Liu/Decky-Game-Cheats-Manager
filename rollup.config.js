import { execFileSync } from "node:child_process";
import deckyPlugin from "@decky/rollup";

execFileSync(process.env.PYTHON || (process.platform === "win32" ? "python" : "python3"),
  ["scripts/build_gcm_core.py"], { stdio: "inherit" });

export default deckyPlugin({});
