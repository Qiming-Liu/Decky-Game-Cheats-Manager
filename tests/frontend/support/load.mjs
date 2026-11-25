// Loads TypeScript modules from the source tree for tests, without a build.
// Relative imports (other modules and JSON data) are followed; anything else
// must be given in `packages`.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const compilerOptions = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX };

/**
 * A loader with its own module cache. `globals` are visible to every module
 * (e.g. SteamClient, window); `packages` maps bare import names to stand-ins.
 */
export function createLoader({ globals = {}, packages = {} } = {}) {
  const cache = new Map();
  function resolve(from, name) {
    const base = path.resolve(path.dirname(from), name);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
      if (existsSync(candidate) && !candidate.endsWith(path.sep) && path.extname(candidate)) return candidate;
    }
    throw new Error(`Cannot resolve ${name} from ${from}`);
  }
  function loadFile(file) {
    if (cache.has(file)) return cache.get(file).exports;
    if (file.endsWith(".json")) {
      const module = { exports: JSON.parse(readFileSync(file, "utf8")) };
      cache.set(file, module);
      return module.exports;
    }
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions, fileName: file });
    const module = { exports: {} };
    cache.set(file, module);
    const require = name => {
      if (name.startsWith(".")) return loadFile(resolve(file, name));
      if (name in packages) return packages[name];
      throw new Error(`${path.relative(ROOT, file)} imports "${name}", which the test did not provide`);
    };
    vm.runInNewContext(outputText, { module, exports: module.exports, require, Intl, ...globals });
    return module.exports;
  }
  /** Loads a module by its path from the repository root, e.g. "src/domain/options". */
  return name => loadFile(resolve(path.join(ROOT, "x"), `./${name}`));
}

/** The exports of several modules merged, loaded together. */
export function load(names, options) {
  const loader = createLoader(options);
  return Object.assign({}, ...[names].flat().map(loader));
}
