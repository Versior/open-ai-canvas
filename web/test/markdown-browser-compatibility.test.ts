import { expect, test } from "bun:test";
import { transformSync } from "@babel/core";
import { fileURLToPath } from "node:url";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmAutolinkLiteral } from "micromark-extension-gfm-autolink-literal";
import { gfmAutolinkLiteralFromMarkdown } from "mdast-util-gfm-autolink-literal";
import type { Root } from "mdast";

test("the actual Markdown dependency bundle has no lookbehind literals that crash iOS WebViews", async () => {
    const build = await Bun.build({ entrypoints: [fileURLToPath(new URL("./lib/index.js", import.meta.resolve("mdast-util-gfm-autolink-literal")))], target: "browser" });
    expect(build.success).toBe(true);
    for (const output of build.outputs) {
        transformSync(await output.text(), {
            babelrc: false,
            configFile: false,
            plugins: [
                () => ({
                    visitor: {
                        RegExpLiteral(path) {
                            expect(path.node.pattern).not.toMatch(/\(\?<([=!])/);
                        },
                    },
                }),
            ],
        });
    }
});

test("GFM email links preserve punctuation, neighbouring addresses and invalid prefixes", () => {
    for (const [text, emails] of [
        ["one@example.com,two@example.org", ["one@example.com", "two@example.org"]],
        ["联系：hello@example.com。", ["hello@example.com"]],
        ["中文hello@example.com /hello@example.org", ["hello@example.com"]],
        ["hello@example.123 hello@example.com", ["hello@example.com"]],
        ["中-hello@example.com", ["-hello@example.com"]],
    ] as const) {
        const tree = fromMarkdown(text, { extensions: [gfmAutolinkLiteral()], mdastExtensions: [gfmAutolinkLiteralFromMarkdown()] });
        const paragraph = tree.children[0];
        expect(paragraph.type).toBe("paragraph");
        if (paragraph.type !== "paragraph") throw new Error("Expected paragraph");
        expect(paragraph.children.filter((node) => node.type === "link").map((node) => node.url)).toEqual(emails.map((email) => `mailto:${email}`));
        expect(paragraph.children.map((node) => (node.type === "link" ? node.children.map((child) => ("value" in child ? child.value : "")).join("") : "value" in node ? node.value : "")).join("")).toBe(text);
    }
});

test("the email transform retains its existing boundary checks without consuming Unicode prefixes", () => {
    for (const [text, emails] of [
        ["😀hello@example.com", []],
        ["中-hello@example.com", ["hello@example.com"]],
        ["/hello@example.com", []],
        ["hello@example.123,ok@example.org", ["ok@example.org"]],
    ] as const) {
        const tree: Root = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: text }] }] };
        gfmAutolinkLiteralFromMarkdown().transforms![0](tree);
        const paragraph = tree.children[0];
        if (paragraph.type !== "paragraph") throw new Error("Expected paragraph");
        expect(paragraph.children.filter((node) => node.type === "link").map((node) => node.url)).toEqual(emails.map((email) => `mailto:${email}`));
    }
});
