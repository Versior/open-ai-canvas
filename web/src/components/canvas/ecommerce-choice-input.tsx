import { AutoComplete } from "antd";

export const ECOMMERCE_BRIEF_CHOICES = {
    market: ["中国", "美国", "欧洲", "日本", "东南亚"],
    platform: ["淘宝", "天猫", "京东", "拼多多", "抖音", "小红书", "Amazon", "Shopify", "TikTok Shop", "Etsy"],
    language: ["中文", "English", "日本語", "Deutsch", "Français", "Español"],
    audience: ["日常居家", "通勤办公", "户外运动", "旅行出行", "礼赠场景"],
    direction: ["干净白底，突出商品", "自然光生活场景", "简洁棚拍，强调材质", "细节特写与卖点展示", "社交平台实拍风格"],
    style: ["简洁白底", "自然光生活感", "暖色家居", "冷色科技", "克制高级，突出材质"],
    forbidden: ["不改变商品外观", "不出现未经核实的功效", "不添加价格与促销承诺", "不添加文字"],
} as const;

export function EcommerceChoiceInput({ value, onChange, choices, label, disabled, maxLength = 100 }: { value: string; onChange: (value: string) => void; choices: readonly string[]; label: string; disabled?: boolean; maxLength?: number }) {
    return (
        <AutoComplete
            aria-label={label}
            style={{ width: "100%" }}
            disabled={disabled}
            value={value}
            maxLength={maxLength}
            options={choices.map((value) => ({ value }))}
            onChange={onChange}
            placeholder="选择或自行填写"
            filterOption={(input, option) => String(option?.value).toLowerCase().includes(input.toLowerCase())}
        />
    );
}
