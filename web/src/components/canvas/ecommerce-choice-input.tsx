import { AutoComplete } from "antd";
import { DownOutlined } from "@ant-design/icons";
import { useLayoutEffect, useRef, useState } from "react";
import type { GetRef } from "antd";

export const ECOMMERCE_BRIEF_CHOICES = {
    market: ["中国", "美国", "欧洲", "日本", "东南亚"],
    platform: ["淘宝", "天猫", "京东", "拼多多", "抖音", "小红书", "快手", "微信小店", "1688", "唯品会", "得物", "Amazon", "Shopify", "TikTok Shop", "Etsy", "eBay", "AliExpress", "Temu", "SHEIN", "Shopee", "Lazada", "Walmart", "Mercado Libre", "独立站"],
    aspectRatio: ["1:1", "3:4", "4:3", "2:3", "3:2", "4:5", "5:4", "9:16", "16:9", "21:9", "1:2", "2:1"],
    language: ["中文", "English", "日本語", "Deutsch", "Français", "Español"],
    audience: ["日常居家", "通勤办公", "户外运动", "旅行出行", "礼赠场景"],
    direction: ["干净白底，突出商品", "自然光生活场景", "简洁棚拍，强调材质", "细节特写与卖点展示", "社交平台实拍风格"],
    style: ["简洁白底", "自然光生活感", "暖色家居", "冷色科技", "克制高级，突出材质"],
    forbidden: ["不改变商品外观", "不出现未经核实的功效", "不添加价格与促销承诺", "不添加文字"],
} as const;

export function EcommerceChoiceInput({ value, onChange, choices, label, disabled, maxLength = 100 }: { value: string; onChange: (value: string) => void; choices: readonly string[]; label: string; disabled?: boolean; maxLength?: number }) {
    const [query, setQuery] = useState("");
    const [open, setOpen] = useState(false);
    const [custom, setCustom] = useState(false);
    const selectRef = useRef<GetRef<typeof AutoComplete>>(null);
    const [popupWidth, setPopupWidth] = useState<number>();
    useLayoutEffect(() => {
        const element = selectRef.current?.nativeElement;
        if (!open || !element) return;
        // 使用布局宽度，避免 AntD 把缩放后的屏幕宽度再次用于弹层伸展。
        const measure = () => setPopupWidth(element.offsetWidth);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(element);
        return () => observer.disconnect();
    }, [open]);
    return (
        <AutoComplete
            ref={selectRef}
            aria-label={label}
            style={{ width: "100%" }}
            disabled={disabled}
            // 与节点共用缩放坐标系，同时避开节点内部的 overflow 裁切。
            getPopupContainer={(trigger: HTMLElement) => trigger.closest<HTMLElement>("[data-canvas-world-raster-layer]") ?? document.body}
            popupMatchSelectWidth={popupWidth}
            styles={{ input: { color: "var(--foreground)" }, popup: { root: { minWidth: 0 } } }}
            popupRender={(menu) => <div>
                {menu}
                <button type="button" disabled={disabled} aria-label={`自定义${label}`}
                    onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }}
                    onClick={(event) => {
                        event.stopPropagation();
                        setCustom(true);
                        setQuery("");
                        selectRef.current?.focus();
                        selectRef.current?.nativeElement.querySelector("input")?.select();
                        setOpen(false);
                    }}
                    style={{ width: "100%", padding: "8px 12px", border: 0, borderTop: "1px solid var(--border)", background: "transparent", color: "var(--foreground)", textAlign: "left", cursor: "pointer", font: "inherit" }}>
                    自定义{label}…
                </button>
            </div>}
            open={open && !disabled}
            value={value}
            maxLength={maxLength}
            options={choices.filter((choice) => choice.toLowerCase().includes(query.trim().toLowerCase())).map((value) => ({ value }))}
            onChange={onChange}
            onSearch={setQuery}
            onFocus={() => setQuery("")}
            onSelect={() => { setCustom(false); setQuery(""); setOpen(false); }}
            onOpenChange={(next) => { setOpen(next); if (next) setQuery(""); }}
            suffixIcon={<button type="button" aria-label={`展开${label}选项`} disabled={disabled} onMouseDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); setQuery(""); setOpen(!open); }} style={{ border: 0, padding: 0, background: "transparent", color: "inherit", cursor: disabled ? "default" : "pointer", pointerEvents: "auto" }}><DownOutlined /></button>}
            placeholder={custom ? `输入自定义${label}` : "选择或自行填写"}
            filterOption={false}
        />
    );
}
