import type { AgentAvatarState } from "@/lib/canvas/agent-appearance";
import type { AgentPetTone } from "@/services/api/agent-pets";

/** 头顶气泡的台词：按形象的说话风格组合时间提醒、未完成项目、灵感、贴心话和形象专属台词。 */
export type AgentPetPersona = { name: string; tone: AgentPetTone; lines: readonly string[] };
export type AgentPetReminderContext = { activeTasks?: number; unfinishedDramas?: number; dramaTitle?: string; recentCanvas?: string };
export type AgentPetLineKind = "greeting" | "care" | "tip" | "signature" | "time" | "tasks" | "dramas" | "canvas" | "long" | "state";
export type AgentPetLine = { kind: AgentPetLineKind; text: string };
export type DayPeriod = "morning" | "noon" | "afternoon" | "evening" | "night";

type TonePack = {
    /** 中性句子的语气包装：前缀与后缀，中性句子本身不带句末标点。 */
    wraps: ReadonlyArray<readonly [string, string]>;
    greetings: Record<DayPeriod, string>;
    care: readonly string[];
    states: Record<Exclude<AgentAvatarState, "idle">, string>;
};

const TONES: Record<AgentPetTone, TonePack> = {
    gentle: {
        wraps: [
            ["", "～"],
            ["", "哦"],
            ["", "呀"],
        ],
        greetings: {
            morning: "早上好呀，现在 {time}，今天也慢慢来～",
            noon: "中午啦，记得好好吃饭哦。",
            afternoon: "下午好，{time} 了，喝口水再继续吧～",
            evening: "晚上好，今天辛苦啦。",
            night: "{time} 了，别熬太晚哦。",
        },
        care: ["喝口水吧，身体最重要～", "眼睛累了就看看远处，休息一下下。", "慢慢来，你已经做得很好啦。", "肩膀放松，深呼吸一下～"],
        states: {
            queued: "收到，我先排个队～",
            running: "我在认真做，稍等一下下～",
            waiting_approval: "有一步需要你确认一下哦，点开面板看看～",
            completed: "搞定啦，去看看吧～",
            failed: "出了点小状况，别担心，再试一次～",
            cancelled: "好的，先停下啦～",
            rejected: "好的，我们换个思路～",
        },
    },
    kitty: {
        wraps: [
            ["", "喵～"],
            ["喵，", "～"],
            ["", "，喵呜"],
        ],
        greetings: {
            morning: "早安喵～现在 {time}，伸个懒腰再开工！",
            noon: "午饭时间到喵，小鱼干也算一顿～",
            afternoon: "下午 {time}，最适合晒太阳打盹喵～",
            evening: "晚上好喵，今天也辛苦你啦～",
            night: "{time} 了喵，猫猫都困了，你也早点睡～",
        },
        care: ["喝口水喵，猫猫都会按时喝水～", "盯屏幕太久啦，看看窗外喵～", "伸个懒腰喵，像猫猫一样舒展～", "你做得很好，奖励自己一下喵～"],
        states: {
            queued: "排队中喵，马上轮到我们～",
            running: "猫猫正在努力工作喵～",
            waiting_approval: "这一步要你点头喵，点开面板看看～",
            completed: "完成喵！快夸夸我～",
            failed: "呜…失败了喵，再来一次就好～",
            cancelled: "停下来了喵，休息一下～",
            rejected: "不要这个喵？那换一个～",
        },
    },
    puppy: {
        wraps: [
            ["", "汪！"],
            ["汪汪，", "！"],
            ["", "，汪～"],
        ],
        greetings: {
            morning: "早上好汪！{time}，精神满满出发！",
            noon: "中午啦汪，先吃饭再干活！",
            afternoon: "下午好汪！{time} 了，起来走两步？",
            evening: "晚上好汪！今天的你超棒！",
            night: "{time} 了汪，该休息啦，明天我还在！",
        },
        care: ["该喝水啦汪！我陪你一起！", "起来活动一下汪，我们去散个步！", "你超棒的汪！继续加油！", "累了就摸摸我，充个电汪～"],
        states: {
            queued: "排队中汪，我在门口等着！",
            running: "全力冲刺中汪！",
            waiting_approval: "需要你批准汪！我乖乖等着！",
            completed: "完成啦汪！快摸摸头！",
            failed: "没成功汪…我们再试一次！",
            cancelled: "收到汪，先停下！",
            rejected: "收到汪！换个方法试试！",
        },
    },
    robot: {
        wraps: [
            ["滴——", "。"],
            ["系统提示：", "。"],
            ["哔哔，", "。"],
        ],
        greetings: {
            morning: "早安。当前时间 {time}，系统状态良好。",
            noon: "检测到午饭时间，建议补充能量。",
            afternoon: "当前时间 {time}，建议补充水分。",
            evening: "晚上好。今日进度良好，可以考虑收尾。",
            night: "提示：现在 {time}，建议开启休息程序。",
        },
        care: ["提示：已持续工作一段时间，建议补水。", "检测到用眼疲劳风险，请眺望远处 20 秒。", "能量水平良好，请继续保持。", "坐姿校准提醒：请挺直后背。"],
        states: {
            queued: "任务已入队，等待执行。",
            running: "执行中，进度正常。",
            waiting_approval: "等待授权：请在面板中确认。",
            completed: "任务完成，结果已就绪。",
            failed: "执行异常，建议检查后重试。",
            cancelled: "任务已终止。",
            rejected: "已撤回，等待新指令。",
        },
    },
    mystic: {
        wraps: [
            ["", "～"],
            ["嘘，", "。"],
            ["星星说：", "。"],
        ],
        greetings: {
            morning: "晨光初现，{time} 正是施展魔法的好时候。",
            noon: "日正当中，先补充些能量吧。",
            afternoon: "午后的风带来了灵感，{time}，试试新想法。",
            evening: "暮色渐浓，今天的星星都为你亮着。",
            night: "{time}，月亮已经很高了，早些歇息吧。",
        },
        care: ["喝口水，魔力会恢复得更快。", "闭上眼数三下，灵感就会降临。", "别心急，好东西都需要一点时间酝酿。", "星星说你今天很努力。"],
        states: {
            queued: "咒语已排队，静候时机。",
            running: "法阵已展开，正在施法…",
            waiting_approval: "需要你亲手解开这道封印，点开面板看看。",
            completed: "魔法生效了，去看看吧。",
            failed: "咒语失灵了，换个念法再来。",
            cancelled: "法阵已撤下。",
            rejected: "此路不通，另寻他径。",
        },
    },
    sunny: {
        wraps: [
            ["", "！"],
            ["嘿，", "！"],
            ["冲呀，", "！"],
        ],
        greetings: {
            morning: "早上好！{time}，今天也冲冲冲！",
            noon: "中午啦！吃饱饭才有力气搞大事！",
            afternoon: "下午好！{time}，再来一波就收工！",
            evening: "晚上好！今天的你闪闪发光！",
            night: "{time} 啦！早点睡，明天继续发光！",
        },
        care: ["喝水喝水！补满能量再出发！", "起来动一动，血条立刻回满！", "你今天超厉害的！", "笑一个！好运马上就来！"],
        states: {
            queued: "排上队啦！马上开搞！",
            running: "火力全开中！",
            waiting_approval: "到你拍板啦！快来面板确认！",
            completed: "大功告成！耶！",
            failed: "跌倒了没关系！马上重来！",
            cancelled: "好嘞，先停一停！",
            rejected: "没问题！换个玩法！",
        },
    },
};

/** 中性灵感，按语气包装后输出。 */
const TIPS = [
    "商品主图试试低角度加一点逆光，质感会高级很多",
    "分镜卡住时，先把镜头拆成远景、中景、特写三档",
    "提示词里写清光线方向，画面会更有层次",
    "同一个角色多准备几张参考图，换镜头时更稳",
    "竖版 9:16 适合短视频，横版 16:9 更适合讲故事",
    "给画面留一点空白，文字和卖点更好摆",
    "把产品放进生活场景里，比纯白底更有代入感",
    "暖色调更温柔，冷色调更有科技感，先定一个情绪",
    "短剧开头三秒最关键，第一个镜头要抓眼",
    "颜色太多时，留一个主色加一个点缀色就够了",
    "人物表情是短剧的灵魂，特写镜头别吝啬",
    "复用满意的提示词模板，能省下不少时间",
    "参考图越清晰，生成结果越可控",
    "镜头长短交替，节奏感马上就出来了",
    "详情页可以按痛点、卖点、证明、下单的顺序排",
    "卡壳的时候把需求说给 Agent 听，一起拆开会轻松很多",
];

const TIME_HINTS: Record<DayPeriod, string> = {
    morning: "先把最重要的一件事排在前面",
    noon: "吃完饭眯一小会儿，下午更有精神",
    afternoon: "起来倒杯水，眼睛也歇一歇",
    evening: "今天的进度不错，可以准备收尾了",
    night: "夜深了，剩下的明天再做也来得及",
};

export function dayPeriod(hour: number): DayPeriod {
    if (hour >= 5 && hour < 11) return "morning";
    if (hour >= 11 && hour < 13) return "noon";
    if (hour >= 13 && hour < 18) return "afternoon";
    if (hour >= 18 && hour < 23) return "evening";
    return "night";
}

export function formatAgentPetTime(date: Date) {
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** 上传形象没有专属风格和台词时，用温柔语气和通用台词。 */
export function agentPetPersona(pet: { name: string; tone: AgentPetTone | ""; lines: readonly string[] }): AgentPetPersona {
    const tone = pet.tone && pet.tone in TONES ? pet.tone : "gentle";
    return { name: pet.name, tone, lines: pet.lines.filter(Boolean) };
}

const pick = <T>(items: readonly T[], random: () => number) => items[Math.min(items.length - 1, Math.floor(random() * items.length))];

function fill(template: string, values: Record<string, string | number>) {
    return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in values ? String(values[key]) : match));
}

function wrap(persona: AgentPetPersona, text: string, random: () => number) {
    const [prefix, suffix] = pick(TONES[persona.tone].wraps, random);
    return `${prefix}${text}${suffix}`;
}

export function agentPetGreeting(persona: AgentPetPersona, now: Date): AgentPetLine {
    return { kind: "greeting", text: fill(TONES[persona.tone].greetings[dayPeriod(now.getHours())], { time: formatAgentPetTime(now), name: persona.name }) };
}

export function agentPetStateLine(persona: AgentPetPersona, state: AgentAvatarState): AgentPetLine | null {
    if (state === "idle") return null;
    return { kind: "state", text: TONES[persona.tone].states[state] };
}

type IdleOptions = {
    now: Date;
    context?: AgentPetReminderContext;
    /** 连续使用达到提醒阈值时传入分钟数，优先提醒休息。 */
    longSessionMinutes?: number;
    /** 最近出现过的台词，尽量不重复。 */
    recent?: readonly string[];
    /** 限定可选的类别，例如悬停时只说专属台词和贴心话。 */
    kinds?: readonly AgentPetLineKind[];
    random?: () => number;
};

function candidates(persona: AgentPetPersona, options: IdleOptions, random: () => number): Array<{ kind: AgentPetLineKind; weight: number; make: () => string }> {
    const { now, context = {} } = options;
    const pack = TONES[persona.tone];
    const period = dayPeriod(now.getHours());
    const list: Array<{ kind: AgentPetLineKind; weight: number; make: () => string }> = [
        { kind: "care", weight: 2, make: () => pick(pack.care, random) },
        { kind: "tip", weight: 2.5, make: () => `💡${wrap(persona, pick(TIPS, random), random)}` },
        { kind: "time", weight: 1, make: () => `⏰${wrap(persona, `现在 ${formatAgentPetTime(now)}，${TIME_HINTS[period]}`, random)}` },
    ];
    if (persona.lines.length) list.push({ kind: "signature", weight: 2.5, make: () => pick(persona.lines, random) });
    if (context.activeTasks) list.push({ kind: "tasks", weight: 2, make: () => `📌${wrap(persona, `还有 ${context.activeTasks} 个生成任务在跑，我帮你盯着`, random)}` });
    if (context.unfinishedDramas) {
        const count = context.unfinishedDramas;
        const text = context.dramaTitle ? (count === 1 ? `短剧《${context.dramaTitle}》还没做完，有空接着做` : `《${context.dramaTitle}》等 ${count} 部短剧还没做完，有空接着做`) : `还有 ${count} 部短剧没做完，有空接着做`;
        list.push({ kind: "dramas", weight: 1.5, make: () => `📌${wrap(persona, text, random)}` });
    }
    if (context.recentCanvas) list.push({ kind: "canvas", weight: 1, make: () => `📌${wrap(persona, `上次的画布《${context.recentCanvas}》还在等你`, random)}` });
    return options.kinds ? list.filter((item) => options.kinds?.includes(item.kind)) : list;
}

/** 空闲时的一句台词。按权重抽类别，尽量避开最近说过的句子。 */
export function agentPetIdleLine(persona: AgentPetPersona, options: IdleOptions): AgentPetLine {
    const random = options.random ?? Math.random;
    if (options.longSessionMinutes) {
        return { kind: "long", text: wrap(persona, `已经连续创作 ${options.longSessionMinutes} 分钟啦，起来伸个懒腰`, random) };
    }
    const pool = candidates(persona, options, random);
    if (!pool.length) return { kind: "care", text: pick(TONES[persona.tone].care, random) };
    const total = pool.reduce((sum, item) => sum + item.weight, 0);
    let line: AgentPetLine | null = null;
    for (let attempt = 0; attempt < 6; attempt += 1) {
        let roll = random() * total;
        const choice = pool.find((item) => (roll -= item.weight) < 0) ?? pool[pool.length - 1];
        line = { kind: choice.kind, text: choice.make() };
        if (!options.recent?.includes(line.text)) break;
    }
    return line as AgentPetLine;
}

/** 气泡停留时长：短句 5 秒，按字数加长，最多 12 秒。 */
export function agentPetBubbleDuration(text: string) {
    return Math.max(5000, Math.min(12000, 3500 + [...text].length * 120));
}
