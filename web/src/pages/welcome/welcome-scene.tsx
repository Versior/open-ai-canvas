import { useTranslation } from "react-i18next";
import { showcases, type WelcomeLook } from "./story";

/** 每一幕使用不同构图；文本与演示素材来自同一版本，低动态模式也保留完整画面。 */
export function WelcomeScene({ chapter, look, reduced }: { chapter: number; look: WelcomeLook; reduced: boolean }) {
    const { t } = useTranslation();
    return (
        <div className={`welcome-scene welcome-scene-${chapter}`} aria-hidden="true">
            {chapter === 1 ? (
                <>
                    <img className="welcome-scene-landscape" src={look.frames[0]} alt="" />
                    <article className="welcome-script-page">
                        <span>01 / {t(look.title)}</span>
                        <h3>{t(look.screenplay[0])}</h3>
                        {look.screenplay.slice(1, 5).map((line) => (
                            <p key={line}>{t(line)}</p>
                        ))}
                    </article>
                </>
            ) : chapter === 2 ? (
                <div className="welcome-character-frames">
                    {[1, 2].map((index) => (
                        <img key={index} src={look.frames[index]} alt="" />
                    ))}
                </div>
            ) : chapter === 3 ? (
                <div className="welcome-storyboard">
                    {[0, 2, 4].map((index, order) => (
                        <figure key={index}>
                            <img src={look.frames[index]} alt="" />
                            <figcaption>
                                <span>0{order + 1}</span>
                                {t(look.screenplay[index])}
                            </figcaption>
                        </figure>
                    ))}
                </div>
            ) : chapter === 4 ? (
                look.video && !reduced ? (
                    <video src={look.video} autoPlay muted loop playsInline preload="metadata" poster={look.frames[3]} />
                ) : (
                    <img className="welcome-moving-frame" src={look.frames[3]} alt="" />
                )
            ) : (
                <div className="welcome-canvas-spread">
                    {showcases.map((item) => (
                        <figure key={item.href}>
                            <img src={item.image} alt="" />
                            <figcaption>{t(item.name)}</figcaption>
                        </figure>
                    ))}
                </div>
            )}
        </div>
    );
}
