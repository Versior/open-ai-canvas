import { expect, test } from "bun:test";
import { commerceKnowledgeDomainRows } from "../src/pages/admin/knowledge-domain-coverage";

test("admin knowledge coverage includes the studio design domain and marks missing domains empty", () => {
    const rows = commerceKnowledgeDomainRows({ KB01: 12, KB04: 3, KB20: 81, legacy: 8 });

    expect(rows).toHaveLength(20);
    expect(rows.map(({ id }) => id)).toEqual(["KB01", "KB02", "KB03", "KB04", "KB05", "KB06", "KB07", "KB08", "KB09", "KB10", "KB11", "KB12", "KB13", "KB14", "KB15", "KB16", "KB17", "KB18", "KB19", "KB20"]);
    expect(rows[0]).toMatchObject({ label: "全球电商行业", count: 12 });
    expect(rows[3]).toMatchObject({ label: "主图与详情页排版", count: 3 });
    expect(rows[1].count).toBe(0);
    expect(rows[19]).toMatchObject({ label: "商品设计策划与版式", count: 81 });
});

test("missing admin domain coverage safely renders twenty empty knowledge domains", () => {
    expect(commerceKnowledgeDomainRows()).toHaveLength(20);
    expect(commerceKnowledgeDomainRows().every(({ count }) => count === 0)).toBe(true);
});
