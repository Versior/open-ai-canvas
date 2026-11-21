import { App, Button } from "antd";
import { saveAs } from "file-saver";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { STUDIO_COMPOSITIONS, STUDIO_IMAGE_ZONES } from "@/lib/ecommerce-studio/art-direction";
import { studioPlatformForbidsText } from "@/lib/ecommerce-studio/brief";
import { studioEntryRatio, type StudioSetEntry } from "@/lib/ecommerce-studio/runs";
import type { StudioCompiledPrompt } from "@/lib/ecommerce-studio/prompt-compiler";
import { studioProductStyle } from "@/lib/ecommerce-studio/shot-specs";
import { studioCopyPair, studioTextRuns, studioTypography } from "@/lib/ecommerce-studio/typography";
import { studioReadableInk } from "@/lib/ecommerce-studio/typeset";
import { STUDIO_VIEW_LABEL, type StudioAttempt, type StudioDetailPlan, type StudioPhoto, type StudioProduct } from "@/lib/ecommerce-studio/types";
import { getActiveUserScope } from "@/lib/user-scope";
import { studioImageUrl } from "./studio-parts";
import { isStudioSpecEntry, renderStudioSpecSheet } from "./studio-spec-sheet";
import { renderStudioLayoutGuide } from "./studio-layout-guide";
import "./studio-plan-preview.css";

function typeset(text: string) {
    return studioTextRuns(text).map((run, index) =>
        run.atomic ? (
            <span className="es-proof-quantity" key={index}>
                {run.text}
            </span>
        ) : (
            run.text
        ),
    );
}

function sourcePhoto(photos: StudioPhoto[], entry: StudioSetEntry) {
    const wanted = entry.role === "detail-package" ? "package" : entry.role === "detail-scene" ? "scene" : /closeup|material/.test(entry.role) ? "detail" : "front";
    return photos.find((photo) => photo.view === wanted) || photos[0];
}

function SubmittedGuide({ compiled }: { compiled?: StudioCompiledPrompt }) {
    const [show, setShow] = useState(false);
    const [result, setResult] = useState<{ url?: string; error?: string }>({});
    useEffect(() => {
        if (!show || !compiled?.layoutGuide?.proof) return;
        try {
            const canvas = renderStudioLayoutGuide(compiled.layoutGuide, compiled.copySnapshot);
            try {
                setResult({ url: canvas.toDataURL("image/png") });
            } finally {
                canvas.width = canvas.height = 0;
            }
        } catch (error) {
            setResult({ error: error instanceof Error ? error.message : "无法绘制定稿参考" });
        }
    }, [compiled, show]);
    return compiled?.layoutGuide?.proof ? (
        <>
            <Button size="small" onClick={() => setShow(!show)}>
                {show ? "收起实际附图" : "查看实际发送的排版参考"}
            </Button>
            {show && (result.error ? <p role="alert">当前参考排不下：{result.error}</p> : result.url ? <img className="es-proof-reference" src={result.url} alt="图片模型收到的排版参考（灰色是摄影位置）" /> : null)}
        </>
    ) : (
        <p>当前条件未生成可附的排版参考；请核对图片模型、参考图名额、同款设置和本屏是否排字。</p>
    );
}

function ProofPage({ product, plan, entry, index, photos, input }: { product: StudioProduct; plan: StudioDetailPlan; entry: StudioSetEntry; index: number; photos: StudioPhoto[]; input?: StudioAttempt["input"] }) {
    const { message } = App.useApp();
    const [sourceId, setSourceId] = useState("");
    const [exporting, setExporting] = useState(false);
    const sheet = useRef<HTMLElement>(null);
    const textBlock = useRef<HTMLDivElement>(null);
    const [outside, setOutside] = useState(false);
    const photo = photos.find((item) => item.resourceId === sourceId) || sourcePhoto(photos, entry);
    const textless = entry.noText || product.brief.language === "none" || entry.role === "main-white" || studioPlatformForbidsText(product, entry.role);
    const copy = textless ? undefined : entry.copy;
    const infoPage = Boolean(copy && isStudioSpecEntry(entry));
    const composition = entry.composition || "top";
    const zone = STUDIO_COMPOSITIONS[composition].zone;
    const images = textless ? [[0, 0, 1, 1]] : STUDIO_IMAGE_ZONES[composition];
    const design = plan.screens[entry.planIndex!];
    const color = studioProductStyle(product, plan.styleId);
    const background = color.palette[0].hex;
    const rgb = [1, 3, 5].map((start) => Number.parseInt(background.slice(start, start + 2), 16)) as [number, number, number];
    const ratio = input?.request.aspectRatio || studioEntryRatio(entry, product);
    const [columns, rows] = ratio.split(":").map(Number);
    const mobileStyle = {
        "--paper": background,
        "--ink": studioReadableInk(color.ink, rgb),
        "--headline-font": studioTypography(plan.tone).family,
        "--headline-weight": studioTypography(plan.tone).headlineWeight,
        aspectRatio: infoPage ? undefined : `${columns} / ${rows}`,
    } as CSSProperties;
    const textStyle = infoPage
        ? undefined
        : ({
              left: `${zone.x * 100}%`,
              top: `${zone.y * 100}%`,
              width: `${zone.width * 100}%`,
              minHeight: `${zone.height * 100}%`,
              justifyContent: zone.vAlign === "center" ? "center" : zone.vAlign === "bottom" ? "end" : "start",
              textAlign: zone.align,
          } as CSSProperties);
    useEffect(() => {
        const page = sheet.current,
            block = textBlock.current;
        if (!page || !block || infoPage || typeof ResizeObserver === "undefined") {
            setOutside(false);
            return;
        }
        const check = () => setOutside(block.offsetHeight > page.clientHeight * zone.height + 2 || block.scrollWidth > block.clientWidth + 1);
        const observer = new ResizeObserver(check);
        observer.observe(page);
        observer.observe(block);
        check();
        return () => observer.disconnect();
    }, [zone.height, infoPage, copy]);
    const exportSpec = async () => {
        if (!photo) return;
        const scope = getActiveUserScope();
        setExporting(true);
        try {
            const file = await renderStudioSpecSheet(product, entry, photo.resourceId);
            if (getActiveUserScope() === scope) saveAs(file, `${String(index + 1).padStart(2, "0")}-${entry.title.replace(/[\\/:*?"<>|]/g, "_")}-规格图.png`);
        } catch (error) {
            if (getActiveUserScope() === scope) message.error(error instanceof Error ? error.message : "规格图导出失败");
        } finally {
            setExporting(false);
        }
    };
    const photograph = photo ? <img loading="lazy" src={studioImageUrl(photo.resourceId, true)} alt={photo.name || "商品实拍"} /> : <span>没有已确认商品图</span>;
    return (
        <section className="es-proof-item" aria-label={`第 ${index + 1} 屏：${entry.title}`}>
            <article ref={sheet} className="es-proof-sheet" data-spec={infoPage || undefined} style={mobileStyle} aria-label="买家视图排样">
                {!infoPage &&
                    images.map(([left, top, width, height], slot) => (
                        <div key={slot} className="es-proof-photo" style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${width * 100}%`, height: `${height * 100}%` }}>
                            {slot === 0 ? photograph : <span>补充摄影位</span>}
                        </div>
                    ))}
                {copy && (
                    <div ref={textBlock} className="es-proof-copy" style={textStyle}>
                        {entry.eyebrow && <small>{typeset(entry.eyebrow)}</small>}
                        {copy.headline && <h4>{typeset(copy.headline)}</h4>}
                        {copy.subline && <p>{typeset(copy.subline)}</p>}
                        {infoPage && <div className="es-proof-spec-photo">{photograph}</div>}
                        {copy.lines.length > 0 && (
                            <dl>
                                {copy.lines.map((line, row) => {
                                    const [label, value] = studioCopyPair(line);
                                    return (
                                        <div key={row}>
                                            <dt>{typeset(label)}</dt>
                                            {value && <dd>{typeset(value)}</dd>}
                                        </div>
                                    );
                                })}
                            </dl>
                        )}
                    </div>
                )}
            </article>
            {outside && (
                <p className="es-proof-overflow" role="status">
                    定稿在当前手机宽度超出预留文字区。请改短文案、换构图或拆屏，不要缩小字号硬塞。
                </p>
            )}
            <details className="es-proof-annotation">
                <summary>
                    第 {index + 1} 屏 · {entry.title} · 核对证据
                </summary>
                <p>
                    <strong>买家问题：</strong>
                    {entry.purpose || "未标明"}
                </p>
                <p>
                    <strong>商品依据：</strong>
                    {design?.facts.length ? design.facts.join("、") : "未指定事实，请对照商品实拍核实"}
                </p>
                {entry.elements && (
                    <p>
                        <strong>排版说明：</strong>
                        {entry.elements}
                    </p>
                )}
                {photos.length > 0 && (
                    <label>
                        排样参照（不改生图素材）{" "}
                        <select value={photo?.resourceId} onChange={(event) => setSourceId(event.target.value)}>
                            {photos.map((item, position) => (
                                <option key={item.id} value={item.resourceId}>
                                    {position + 1}. {item.name || STUDIO_VIEW_LABEL[item.view]}
                                </option>
                            ))}
                        </select>
                    </label>
                )}
                {infoPage && (
                    <Button size="small" disabled={!photo} loading={exporting} onClick={() => void exportSpec()}>
                        导出规格 PNG（实拍＋逐字排版）
                    </Button>
                )}
                {product.brief.useProofLayout && <SubmittedGuide compiled={input?.compiled} />}
            </details>
        </section>
    );
}

export function StudioPlanPreview({
    product,
    plan,
    entries,
    inputs,
    onProofLayoutChange,
}: {
    product: StudioProduct;
    plan: StudioDetailPlan;
    entries: StudioSetEntry[];
    inputs: readonly NonNullable<StudioAttempt["input"]>[];
    onProofLayoutChange: (value: boolean) => void;
}) {
    const [open, setOpen] = useState(false);
    const [width, setWidth] = useState<375 | 390>(375);
    const selected = entries.filter((entry) => entry.included && entry.planIndex !== undefined);
    const photos = product.photos.filter((photo) => photo.truth);
    return (
        <>
            <Button block disabled={!selected.length} onClick={() => setOpen(true)}>
                手机整页排样 · {selected.length} 屏
            </Button>
            <AppModal title="手机整页排样" open={open} onCancel={() => setOpen(false)} width={520} footer={null}>
                {open && (
                    <div className="es-proof-view">
                        <header>
                            <div role="group" aria-label="手机阅读宽度">
                                {([375, 390] as const).map((value) => (
                                    <Button key={value} size="small" aria-pressed={width === value} type={width === value ? "primary" : "default"} onClick={() => setWidth(value)}>
                                        {value} px
                                    </Button>
                                ))}
                            </div>
                            <p>按所选宽度查看真实文案与商品实拍，窄窗口可横向滑动。排样不调用模型，摄影不是最终成图；规格页可单独导出定稿。</p>
                            <label>
                                <input type="checkbox" checked={!!product.brief.useProofLayout} onChange={(event) => onProofLayoutChange(event.target.checked)} /> 出图附上定稿排版参考
                            </label>
                            <p>每张适用的策划图多带一张排版参考，按实际参考图数报价；不替换实拍，不保证模型逐像素复现。指定参考同款和修正旧图时优先原参考。</p>
                        </header>
                        <div className="es-proof-scroll" role="region" aria-label="整页排样滚动区" tabIndex={0}>
                            <div className="es-proof-long" style={{ width }}>
                                {selected.map((entry, index) => (
                                    <ProofPage key={entry.key} product={product} plan={plan} entry={entry} index={index} photos={photos} input={inputs[index]} />
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </AppModal>
        </>
    );
}
