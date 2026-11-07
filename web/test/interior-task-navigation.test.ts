import { expect, test } from "bun:test";
import { availableInteriorTasks } from "@/pages/interior/interior-navigator";
import type { InteriorCatalog, InteriorMode } from "@/services/api/interior";

function catalog(allowSurfaceSwitch: boolean): InteriorCatalog {
    const mode = (id: string, audience: InteriorMode["audience"], enabled = true): InteriorMode => ({
        id,
        key: id,
        name: id,
        subtitle: "",
        description: "",
        audience,
        enabled,
        slots: [],
        params: [],
        requiresRoom: false,
        requiresStyle: false,
        notesRequired: false,
        allowedModels: [],
        maxCount: 1,
        sortOrder: 0,
        builtin: true,
        version: 1,
        updatedAt: "",
    });
    return { settings: { defaultSurface: "quick", allowSurfaceSwitch, maxStylesPerRun: 1, maxCountPerStyle: 1 }, modes: [mode("quick", "quick"), mode("pro", "pro"), mode("shared", "both"), mode("disabled", "both", false)], styles: [], rooms: [] };
}

test("locked interior surface filters navigation and material handoff targets", () => {
    expect(availableInteriorTasks(catalog(false), "quick").map((mode) => mode.id)).toEqual(["quick", "shared"]);
    expect(availableInteriorTasks(catalog(false), "pro").map((mode) => mode.id)).toEqual(["pro", "shared"]);
});

test("unlocked interior navigation can reach both audiences but excludes disabled tasks", () => {
    for (const surface of ["quick", "pro"] as const) expect(availableInteriorTasks(catalog(true), surface).map((mode) => mode.id)).toEqual(["quick", "pro", "shared"]);
});
