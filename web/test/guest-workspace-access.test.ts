import { describe, expect, test } from "bun:test";

import { isGuestWorkspacePath } from "../src/lib/guest-workspace";

describe("guest workspace route access", () => {
    test("allows creation, assets and every public feature preview", () => {
        expect(isGuestWorkspacePath("/")).toBe(true);
        expect(isGuestWorkspacePath("/create")).toBe(true);
        expect(isGuestWorkspacePath("/assets")).toBe(true);
        for (const path of ["/canvas", "/projects", "/studio", "/ecommerce", "/interior", "/packaging", "/toolbox/image", "/toolbox/video", "/skills", "/plugins", "/plugins/eagle", "/inspiration", "/tasks"]) expect(isGuestWorkspacePath(path)).toBe(true);
    });

    test("does not expose account details or management routes", () => {
        expect(isGuestWorkspacePath("/admin")).toBe(false);
        expect(isGuestWorkspacePath("/create/anything")).toBe(false);
        expect(isGuestWorkspacePath("/canvas/private-id")).toBe(false);
        expect(isGuestWorkspacePath("/projects/private-id")).toBe(false);
        expect(isGuestWorkspacePath("/skills/private-id/edit")).toBe(false);
        expect(isGuestWorkspacePath("/settings")).toBe(false);
    });
});
