import { defineConfig } from "tsup"
import { execSync } from "child_process"
import pkg from "./package.json"

let git = "unknown"
try {
  git = execSync("git rev-parse --short HEAD").toString().trim()
} catch {}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  define: {
    __VERSION__: JSON.stringify(pkg.version),
    __GIT_HASH__: JSON.stringify(git),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
})