import { useEffect, useRef, useState, type RefObject } from "react";
import { timelineLutCube, type TimelineLut } from "@/lib/timeline/timeline-lut";

/** GPU 对真实媒体帧做 3D LUT 三线性采样；仅覆盖画面，底层视频继续负责声音和播放。 */
export function EditorLutPreview({ mediaRef, lut, mediaKey, compare }: { mediaRef: RefObject<HTMLVideoElement | HTMLImageElement | null>; lut?: TimelineLut; mediaKey?: string | null; compare: boolean }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [error, setError] = useState("");
    const enabled = Boolean(lut && lut.strength > 0 && !compare);
    useEffect(() => {
        setError("");
        if (!enabled || !lut || !canvasRef.current || !mediaRef.current) return;
        const canvas = canvasRef.current;
        const media = mediaRef.current;
        const gl = canvas.getContext("webgl2", { alpha: false, antialias: false, preserveDrawingBuffer: true });
        if (!gl) {
            setError("当前浏览器不支持 LUT 实时预览；导出仍会应用所选 LUT");
            return;
        }
        let frame = 0;
        let lastDraw = -100;
        let lastMediaTime = -1;
        let failed = false;
        const shaders: WebGLShader[] = [];
        const textures: WebGLTexture[] = [];
        const program = gl.createProgram()!;
        const align = () => {
            const box = media.getBoundingClientRect();
            const parent = canvas.parentElement!.getBoundingClientRect();
            Object.assign(canvas.style, { left: `${box.left - parent.left}px`, top: `${box.top - parent.top}px`, width: `${box.width}px`, height: `${box.height}px` });
        };
        const observer = new ResizeObserver(align);
        observer.observe(media);
        observer.observe(canvas.parentElement!);
        align();
        try {
            const cube = timelineLutCube(lut);
            const compile = (type: number, source: string) => {
                const shader = gl.createShader(type)!;
                shaders.push(shader);
                gl.shaderSource(shader, source);
                gl.compileShader(shader);
                if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error("LUT 预览着色器不可用");
                gl.attachShader(program, shader);
            };
            compile(
                gl.VERTEX_SHADER,
                `#version 300 es
                out vec2 uv;
                void main() {
                    uv = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
                    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
                }`,
            );
            compile(
                gl.FRAGMENT_SHADER,
                `#version 300 es
                precision highp float;
                precision highp sampler3D;
                in vec2 uv;
                uniform sampler2D source;
                uniform sampler3D lut;
                uniform vec3 domainMin;
                uniform vec3 domainMax;
                uniform float size;
                uniform float strength;
                out vec4 color;
                void main() {
                    vec3 original = texture(source, uv).rgb;
                    vec3 coord = clamp((original - domainMin) / (domainMax - domainMin), 0.0, 1.0);
                    coord = (coord * (size - 1.0) + 0.5) / size;
                    color = vec4(mix(original, texture(lut, coord).rgb, strength), 1.0);
                }`,
            );
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("LUT 预览初始化失败");
            gl.useProgram(program);
            const texture = (unit: number, target: number) => {
                const result = gl.createTexture()!;
                textures.push(result);
                gl.activeTexture(gl.TEXTURE0 + unit);
                gl.bindTexture(target, result);
                gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
                gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
                gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
                gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
                return result;
            };
            const source = texture(0, gl.TEXTURE_2D);
            texture(1, gl.TEXTURE_3D);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGB8, cube.size, cube.size, cube.size, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(cube.values.map((v) => Math.round(v * 255))));
            gl.uniform1i(gl.getUniformLocation(program, "source"), 0);
            gl.uniform1i(gl.getUniformLocation(program, "lut"), 1);
            gl.uniform3fv(gl.getUniformLocation(program, "domainMin"), cube.domainMin);
            gl.uniform3fv(gl.getUniformLocation(program, "domainMax"), cube.domainMax);
            gl.uniform1f(gl.getUniformLocation(program, "size"), cube.size);
            gl.uniform1f(gl.getUniformLocation(program, "strength"), lut.strength);
            const draw = (time: number) => {
                if (failed) return;
                frame = requestAnimationFrame(draw);
                if (time - lastDraw < 50) return;
                const width = "videoWidth" in media ? media.videoWidth : media.naturalWidth;
                const height = "videoHeight" in media ? media.videoHeight : media.naturalHeight;
                if (!width || !height || ("readyState" in media && media.readyState < 2)) return;
                const mediaTime = "currentTime" in media ? media.currentTime : 0;
                if (mediaTime === lastMediaTime) return;
                lastMediaTime = mediaTime;
                lastDraw = time;
                const scale = Math.min(1, 960 / Math.max(width, height));
                const w = Math.max(1, Math.round(width * scale)),
                    h = Math.max(1, Math.round(height * scale));
                if (canvas.width !== w || canvas.height !== h) {
                    canvas.width = w;
                    canvas.height = h;
                }
                try {
                    gl.viewport(0, 0, w, h);
                    gl.activeTexture(gl.TEXTURE0);
                    gl.bindTexture(gl.TEXTURE_2D, source);
                    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
                    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, media);
                    if (gl.getError() !== gl.NO_ERROR) throw new Error("媒体无法用于 LUT 预览");
                    gl.drawArrays(gl.TRIANGLES, 0, 3);
                    align();
                    canvas.style.visibility = "visible";
                } catch {
                    failed = true;
                    canvas.style.visibility = "hidden";
                    setError("此素材暂不能实时预览 LUT；导出仍会应用所选 LUT");
                }
            };
            frame = requestAnimationFrame(draw);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "LUT 预览失败");
        }
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            canvas.style.visibility = "hidden";
            textures.forEach((texture) => gl.deleteTexture(texture));
            shaders.forEach((shader) => gl.deleteShader(shader));
            gl.deleteProgram(program);
        };
    }, [enabled, lut, mediaKey, mediaRef]);
    return (
        <>
            {enabled ? <canvas ref={canvasRef} aria-label="LUT 调色预览" className="pointer-events-none absolute object-contain" style={{ visibility: "hidden" }} /> : null}
            {enabled && error ? (
                <span role="status" className="absolute bottom-2 left-2 right-2 rounded bg-black/80 p-2 text-xs text-amber-200">
                    {error}
                </span>
            ) : null}
        </>
    );
}
