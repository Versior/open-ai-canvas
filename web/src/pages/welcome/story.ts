/** 界面文案字段（label、title、subtitle 等）保存 i18n 键，渲染时翻译；首幕标题是品牌名，直接显示。 */
export const chapters = [
    { id: "opening", label: "account.welcome.chapters.opening.label", title: "STAGE", subtitle: "account.welcome.chapters.opening.subtitle", description: "account.welcome.chapters.opening.description" },
    { id: "story", label: "account.welcome.chapters.story.label", title: "account.welcome.chapters.story.title" },
    { id: "world", label: "account.welcome.chapters.world.label", title: "account.welcome.chapters.world.title" },
    { id: "shots", label: "account.welcome.chapters.shots.label", title: "account.welcome.chapters.shots.title" },
    { id: "motion", label: "account.welcome.chapters.motion.label", title: "account.welcome.chapters.motion.title" },
    { id: "canvas", label: "account.welcome.chapters.canvas.label", title: "account.welcome.chapters.canvas.title" },
] as const;

export type WelcomeLook = {
    id: string;
    label: string;
    title: string;
    frames: string[];
    screenplay: string[];
    video?: string;
    credit?: string;
};

/** 剧本台词保存为 account.welcome.looks.<look>.screenplay.<n> 键，渲染时翻译。 */
const screenplayKeys = (look: string) => Array.from({ length: 12 }, (_, index) => `account.welcome.looks.${look}.screenplay.line${index + 1}`);
const reelFrames = (folder: string, names: string[]) => Array.from({ length: 12 }, (_, index) => `/welcome/${folder}/${names[index % names.length]}.webp`);

export const welcomeLooks: WelcomeLook[] = [
    {
        id: "spring",
        label: "account.welcome.looks.spring.label",
        title: "account.welcome.looks.spring.title",
        frames: reelFrames("spring", ["1807", "1669", "4336", "3191", "3250"]),
        screenplay: screenplayKeys("spring"),
        credit: "account.welcome.looks.spring.credit",
    },
    {
        id: "charge",
        label: "account.welcome.looks.charge.label",
        title: "account.welcome.looks.charge.title",
        frames: reelFrames("charge", ["factory-final", "einar", "robot", "character-final", "factory"]),
        screenplay: screenplayKeys("charge"),
        video: "/welcome/charge/sequence.mp4",
        credit: "account.welcome.looks.charge.credit",
    },
    {
        id: "wing-it",
        label: "account.welcome.looks.wingIt.label",
        title: "account.welcome.looks.wingIt.title",
        frames: reelFrames("wing-it", ["banner", "pitch", "sky-01", "barn", "sky-04", "sky-06"]),
        screenplay: screenplayKeys("wingIt"),
        credit: "account.welcome.looks.wingIt.credit",
    },
];

/** 每轮展示全部素材，轮次交界也不连续重复。 */
export function shuffleWelcomeLooks(previousId = "", random = Math.random): WelcomeLook[] {
    const looks = [...welcomeLooks];
    for (let index = looks.length - 1; index > 0; index--) {
        const other = Math.floor(random() * (index + 1));
        [looks[index], looks[other]] = [looks[other], looks[index]];
    }
    if (looks[0].id === previousId) [looks[0], looks[1]] = [looks[1], looks[0]];
    return looks;
}

export const showcases = [
    { name: "account.welcome.showcases.video.name", image: "/welcome/workbench-video-v2.jpg", detail: "account.welcome.showcases.video.detail", href: "/video-replication" },
    { name: "account.welcome.showcases.studio.name", image: "/welcome/workbench-studio-v2.jpg", detail: "account.welcome.showcases.studio.detail", href: "/studio" },
    { name: "account.welcome.showcases.interior.name", image: "/welcome/workbench-interior-v2.jpg", detail: "account.welcome.showcases.interior.detail", href: "/interior" },
] as const;
