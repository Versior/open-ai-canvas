import { expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const kinds: string[] = [];
mock.module("../../src/pages/canvas/index", () => ({
    default: ({ kind }: { kind: string }) => {
        kinds.push(kind);
        return <main>我的电商画布</main>;
    },
}));
const { default: EcommerceEntry } = await import("../../src/pages/canvas/ecommerce-entry");

test("entering ecommerce shows its own library without automatic creation", () => {
    const html = renderToStaticMarkup(<EcommerceEntry />);
    expect(html).toContain("我的电商画布");
    expect(kinds).toEqual(["ecommerce"]);
});
