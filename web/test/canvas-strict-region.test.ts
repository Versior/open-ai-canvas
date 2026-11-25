import { expect, test } from "bun:test";
import { regionEditIssue } from "@/lib/canvas/image-region-edit";

test("strict edits cannot silently downgrade to a reference redraw", () => {
    const png = { width: 1024, height: 1536 };
    const ordinary = { maxImages: 1, maskSupported: true };
    expect(regionEditIssue("strict", ordinary, png)).toContain("实测");
    expect(regionEditIssue("reference", ordinary, png)).toBe("");
    const verified = { ...ordinary, strictRegionVerified: true };
    expect(regionEditIssue("strict", verified, png)).toBe("");
    expect(regionEditIssue("strict", verified, { width: 5000, height: 4000 })).toContain("像素");
    expect(regionEditIssue("reference", { maxImages: 0, maskSupported: false }, png)).not.toBe("");
});
