import type { PackagingProject } from "./types";

export type PackagingSnapshot = Pick<PackagingProject, "name" | "document">;

export class PackagingHistory {
    private past: PackagingSnapshot[] = [];
    private future: PackagingSnapshot[] = [];
    private group?: string;
    private editedAt = 0;
    private gesture?: { snapshot?: PackagingSnapshot; past: PackagingSnapshot[]; future: PackagingSnapshot[] };

    get canUndo() {
        return this.past.length > 0;
    }
    get canRedo() {
        return this.future.length > 0;
    }

    record(previous: PackagingSnapshot, group?: string, now = Date.now()) {
        if (!group || group !== this.group || (!this.gesture && now - this.editedAt > 400)) {
            if (this.gesture && !this.gesture.snapshot) this.gesture.snapshot = { name: previous.name, document: previous.document };
            this.past.push({ name: previous.name, document: previous.document });
            if (this.past.length > 60) this.past.shift();
        }
        this.future = [];
        this.group = group;
        this.editedAt = now;
    }

    undo(current: PackagingSnapshot) {
        this.endGroup();
        const snapshot = this.past.pop();
        if (!snapshot) return;
        this.future.push({ name: current.name, document: current.document });
        this.group = undefined;
        return snapshot;
    }

    redo(current: PackagingSnapshot) {
        this.endGroup();
        const snapshot = this.future.pop();
        if (!snapshot) return;
        this.past.push({ name: current.name, document: current.document });
        this.group = undefined;
        return snapshot;
    }

    endGroup() {
        this.group = undefined;
        this.gesture = undefined;
    }

    beginGesture() {
        this.group = undefined;
        this.gesture = { past: this.past.slice(), future: this.future };
    }

    cancelGesture() {
        const snapshot = this.gesture?.snapshot;
        if (this.gesture) {
            this.past = this.gesture.past;
            this.future = this.gesture.future;
        }
        this.endGroup();
        return snapshot;
    }

    clear() {
        this.past = [];
        this.future = [];
        this.group = undefined;
        this.gesture = undefined;
    }
}
