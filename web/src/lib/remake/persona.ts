// AI 生成模特：按性别、年龄段、长相地区、体型和穿搭写一张原创模特的全身照提示词。
// 只生成成年人；人物是原创的，不模仿真人或名人。生成的图放进模特图，和上传的模特图一样用。

export type RemakePersona = {
    gender: "female" | "male";
    age: "18-24" | "25-34" | "35-44" | "45-60";
    look: "east-asian" | "southeast-asian" | "south-asian" | "european" | "latin" | "middle-eastern" | "african";
    body: "slim" | "average" | "athletic" | "curvy";
    style: "casual" | "office" | "sport" | "home" | "elegant";
    note: string;
};

export const REMAKE_PERSONA_DEFAULT: RemakePersona = { gender: "female", age: "25-34", look: "east-asian", body: "average", style: "casual", note: "" };

export const REMAKE_PERSONA_OPTIONS = {
    gender: [
        { value: "female", label: "女" },
        { value: "male", label: "男" },
    ],
    age: [
        { value: "18-24", label: "18–24 岁" },
        { value: "25-34", label: "25–34 岁" },
        { value: "35-44", label: "35–44 岁" },
        { value: "45-60", label: "45–60 岁" },
    ],
    look: [
        { value: "east-asian", label: "东亚" },
        { value: "southeast-asian", label: "东南亚" },
        { value: "south-asian", label: "南亚" },
        { value: "european", label: "欧美" },
        { value: "latin", label: "拉美" },
        { value: "middle-eastern", label: "中东" },
        { value: "african", label: "非洲" },
    ],
    body: [
        { value: "slim", label: "纤细" },
        { value: "average", label: "匀称" },
        { value: "athletic", label: "健壮" },
        { value: "curvy", label: "丰满" },
    ],
    style: [
        { value: "casual", label: "日常休闲" },
        { value: "office", label: "通勤" },
        { value: "sport", label: "运动" },
        { value: "home", label: "居家" },
        { value: "elegant", label: "精致" },
    ],
} as const satisfies { [K in Exclude<keyof RemakePersona, "note">]: readonly { value: RemakePersona[K]; label: string }[] };

const LOOK: Record<RemakePersona["look"], string> = {
    "east-asian": "东亚人长相",
    "southeast-asian": "东南亚人长相",
    "south-asian": "南亚人长相",
    european: "欧美白人长相",
    latin: "拉丁裔长相",
    "middle-eastern": "中东人长相",
    african: "非洲裔长相",
};
const BODY: Record<RemakePersona["body"], string> = { slim: "纤细", average: "匀称", athletic: "健壮有线条", curvy: "丰满" };
const STYLE: Record<RemakePersona["style"], string> = {
    casual: "干净的日常休闲装",
    office: "简洁的通勤装",
    sport: "合身的运动装",
    home: "舒适的居家服",
    elegant: "精致得体的时装",
};

export function remakePersonaLabel(persona: RemakePersona) {
    const pick = <K extends Exclude<keyof RemakePersona, "note">>(key: K) => REMAKE_PERSONA_OPTIONS[key].find((item) => item.value === persona[key])?.label || "";
    return [pick("gender"), pick("age"), pick("look"), pick("body"), pick("style")].join(" · ");
}

export function buildRemakePersonaPrompt(persona: RemakePersona) {
    const gender = persona.gender === "male" ? "男性" : "女性";
    const lines = [
        `一张真实摄影风格的带货短视频模特定妆照：一位 ${persona.age} 岁的成年${gender}，${LOOK[persona.look]}，${BODY[persona.body]}身材，穿${STYLE[persona.style]}。`,
        "全身站姿，正面面对镜头，自然微笑，双手自然下垂、手部完整清晰；脸部、发型和服装细节清楚。",
        "纯浅灰色无缝背景，柔和均匀的棚拍光，竖构图，人物居中，头顶和脚下留出少量空间。",
        "原创人物，不要模仿任何真人、明星或网红；画面里不要文字、Logo、水印和其他人。",
    ];
    if (persona.note.trim()) lines.push(`补充：${persona.note.trim()}`);
    return lines.join("\n");
}
