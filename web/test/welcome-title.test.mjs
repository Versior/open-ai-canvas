import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("welcome entry loads configured appearance", async () => {
    const main = source("../src/main.tsx").replace(/\r\n/g, "\n");
    const welcomePath = main.indexOf("/welcome");
    const branchStart = main.lastIndexOf("if (", welcomePath);
    const branchEnd = main.indexOf("} else {", welcomePath);
    assert.ok(welcomePath >= 0 && branchStart >= 0 && branchEnd > welcomePath, "main entry must keep a dedicated welcome branch");
    const welcomeBranch = main.slice(branchStart, branchEnd);
    assert.match(welcomeBranch, /void bootstrapAppearance\(\)\.catch\(\(\) => undefined\);/);
    assert.match(welcomeBranch, /void import\("\.\/welcome-application"\);/);
});

test("welcome effects preserve configured SEO title", () => {
    const page = source("../src/pages/welcome/index.tsx");
    // Run the actual mount effects with inert motion/scroll listeners.
    const effects = [...page.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\n    \}, \[([^\]]*)\]\);/g)].filter((match) => match[2] === "");
    assert.ok(effects.length > 0);
    for (const title of ["Custom SEO Title", "Custom Site Name"]) {
        const document = { title };
        for (const [, body] of effects) {
            vm.runInNewContext(`(() => {${body}\n})()`, {
                document,
                window: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), addEventListener() {}, removeEventListener() {} },
                storyRef: { current: null }, restorePickerFocus: { current: false },
                setReduced() {}, setLook() {}, getWelcomeLook() {},
            });
        }
        assert.equal(document.title, title, "welcome must preserve appearance metadata title");
    }
});
