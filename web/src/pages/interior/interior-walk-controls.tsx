import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { CompiledFloorPlan } from "@/lib/interior/scene-compile";
import type { SpecFloor } from "@/lib/interior/scene-spec";
import { moveWalk, walkStart } from "@/lib/interior/scene-walk";
import type { DesignMark } from "@/lib/interior/design-plan";

export function InteriorWalkControls({ floor, plan, room, obstacles, onUnavailable }: { floor: SpecFloor; plan: CompiledFloorPlan; room: string; obstacles: DesignMark[]; onUnavailable: () => void }) {
    const { camera, gl } = useThree();
    const keys = useRef(new Set<string>());
    const angles = useRef({ yaw: 0, pitch: 0, pointer: -1, x: 0, y: 0 });
    const ready = useRef(false);
    const unavailable = useRef(onUnavailable);
    unavailable.current = onUnavailable;
    useEffect(() => {
        const start = walkStart(floor, plan, room || undefined, obstacles);
        ready.current = Boolean(start);
        if (!start) {
            unavailable.current();
            return;
        }
        camera.position.set(start[0], plan.elevation + Math.min(1.6, floor.height - 0.3), start[1]);
        camera.rotation.order = "YXZ";
        const target = floor.rooms.find((r) => r.name === room) || floor.rooms.find((r) => start[0] >= r.rect[0] && start[0] <= r.rect[2] && start[1] >= r.rect[1] && start[1] <= r.rect[3]);
        const dx = target ? (target.rect[0] + target.rect[2]) / 2 - start[0] : 0;
        const dz = target ? (target.rect[1] + target.rect[3]) / 2 - start[1] : -1;
        angles.current.yaw = Math.hypot(dx, dz) > 0.1 ? Math.atan2(-dx, -dz) : 0;
        angles.current.pitch = -0.15;
        camera.rotation.set(angles.current.pitch, angles.current.yaw, 0);
        keys.current.clear();
    }, [floor, plan, room, camera, obstacles]);
    useEffect(() => {
        const canvas = gl.domElement;
        canvas.tabIndex = 0;
        const clear = () => {
            keys.current.clear();
            angles.current.pointer = -1;
        };
        const down = (event: KeyboardEvent) => {
            if (/^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(event.code)) {
                event.preventDefault();
                keys.current.add(event.code);
            }
        };
        const up = (event: KeyboardEvent) => keys.current.delete(event.code);
        const pointerDown = (event: PointerEvent) => {
            canvas.focus();
            canvas.setPointerCapture(event.pointerId);
            Object.assign(angles.current, { pointer: event.pointerId, x: event.clientX, y: event.clientY });
        };
        const pointerMove = (event: PointerEvent) => {
            const a = angles.current;
            if (a.pointer !== event.pointerId) return;
            a.yaw -= (event.clientX - a.x) * 0.004;
            a.pitch = Math.max(-1.2, Math.min(1.2, a.pitch - (event.clientY - a.y) * 0.004));
            a.x = event.clientX;
            a.y = event.clientY;
        };
        canvas.addEventListener("keydown", down);
        canvas.addEventListener("keyup", up);
        canvas.addEventListener("blur", clear);
        canvas.addEventListener("pointerdown", pointerDown);
        canvas.addEventListener("pointermove", pointerMove);
        canvas.addEventListener("pointerup", clear);
        canvas.addEventListener("pointercancel", clear);
        window.addEventListener("blur", clear);
        return () => {
            clear();
            canvas.removeEventListener("keydown", down);
            canvas.removeEventListener("keyup", up);
            canvas.removeEventListener("blur", clear);
            canvas.removeEventListener("pointerdown", pointerDown);
            canvas.removeEventListener("pointermove", pointerMove);
            canvas.removeEventListener("pointerup", clear);
            canvas.removeEventListener("pointercancel", clear);
            window.removeEventListener("blur", clear);
        };
    }, [gl]);
    useFrame((_, delta) => {
        if (!ready.current) return;
        const a = angles.current,
            k = keys.current;
        const forward = Number(k.has("KeyW") || k.has("ArrowUp")) - Number(k.has("KeyS") || k.has("ArrowDown"));
        const side = Number(k.has("KeyD") || k.has("ArrowRight")) - Number(k.has("KeyA") || k.has("ArrowLeft"));
        const speed = (Math.min(delta, 0.1) * 1.8) / Math.max(1, Math.hypot(forward, side));
        const point = moveWalk([camera.position.x, camera.position.z], [(side * Math.cos(a.yaw) - forward * Math.sin(a.yaw)) * speed, (-forward * Math.cos(a.yaw) - side * Math.sin(a.yaw)) * speed], floor, plan, obstacles);
        camera.position.x = point[0];
        camera.position.z = point[1];
        camera.rotation.set(a.pitch, a.yaw, 0, "YXZ");
    });
    return null;
}
