import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function loadMenu(ui) {
  const source = readFileSync(new URL("../../src/patch.tsx", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  });
  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module, exports: module.exports,
    require(name) {
      if (name === "@decky/ui") return ui;
      if (name === "react/jsx-runtime") return { jsx: () => ({}) };
      return { menuItemLabel: () => "GCM", gamePageRoute: (id) => `/gcm/${id}` };
    },
  });
  return module.exports.default;
}

test("every nested Steam patch is removed, even after repeated renders", () => {
  class Inner {
    render() { return { props: { children: [[]] } }; }
    shouldComponentUpdate() { return true; }
  }
  const component = { _owner: { pendingProps: { overview: { appid: 123 } } }, props: { children: [] }, type: () => ({ type: Inner }) };
  class Library { render() { return component; } }
  const originals = [Library.prototype.render, component.type, Inner.prototype.render, Inner.prototype.shouldComponentUpdate];
  let count = 0;
  const install = loadMenu({
    findModuleByExport: () => ({ factory: function () { /* navigator: */ } }),
    fakeRenderComponent: () => ({ type: Library }), findInTree: () => null,
    afterPatch(target, key, callback) {
      const original = target[key];
      target[key] = function (...args) { return callback(args, original.apply(this, args)); };
      count++;
      return { unpatch() { target[key] = original; count--; } };
    },
  });
  const cleanup = install();
  new Library().render();
  component.type(); component.type();
  assert.equal(count, 4);
  cleanup(); cleanup();
  assert.equal(count, 0);
  assert.deepEqual([Library.prototype.render, component.type, Inner.prototype.render, Inner.prototype.shouldComponentUpdate], originals);
});

test("missing Steam menu leaves plugin initialization available", () => {
  const install = loadMenu({ findModuleByExport() { throw new Error("Steam changed"); } });
  assert.doesNotThrow(() => install()());
});
