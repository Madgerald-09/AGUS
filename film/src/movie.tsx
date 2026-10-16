import React from "react";
import {
  AbsoluteFill,
  Sequence,
  OffthreadVideo,
  Img,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
} from "remotion";
import { FPS, scenes } from "./scenes";
import evidence from "../public/captures/evidence.json";
import "./style.css";
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const ease = (f: number, start = 0, duration = 24) =>
  interpolate(f, [start, start + duration], [0, 1], clamp);
const Atmosphere: React.FC<{ frame: number; light?: boolean }> = ({
  frame,
  light = false,
}) => (
  <AbsoluteFill
    style={{ background: light ? "#ededed" : "#050607", overflow: "hidden" }}
  >
    <div
      style={{
        position: "absolute",
        width: 1700,
        height: 1400,
        left: 450 + Math.sin(frame / 190) * 130,
        top: -500,
        background: light
          ? "radial-gradient(ellipse, #d1d1d1 0%, transparent 62%)"
          : "radial-gradient(ellipse, #30303066 0%, #18181844 32%, transparent 64%)",
        transform: `rotate(${frame / 30}deg)`,
      }}
    />
    <svg
      width="1920"
      height="1080"
      style={{ position: "absolute", opacity: light ? 0.16 : 0.12 }}
    >
      <g
        transform={`translate(1520 460) rotate(${frame / 35})`}
        fill="none"
        stroke={light ? "#8a939a" : "#aebbc7"}
        strokeWidth="1"
      >
        <ellipse rx="730" ry="465" />
        <ellipse rx="700" ry="405" transform="rotate(22)" />
        <ellipse rx="670" ry="345" transform="rotate(44)" />
      </g>
    </svg>
  </AbsoluteFill>
);
const Wordmark: React.FC<{ size?: number; dark?: boolean }> = ({
  size = 280,
  dark = false,
}) => (
  <div
    style={{
      fontSize: size,
      fontWeight: 700,
      letterSpacing: -size * 0.075,
      lineHeight: 1,
      color: dark ? "#090a0b" : "#f7f7f6",
    }}
  >
    agus<span style={{ color: dark ? "#090a0b" : "#d2dce5" }}>.</span>
  </div>
);
const Fade: React.FC<{ frames: number; children: React.ReactNode }> = ({
  frames,
  children,
}) => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill
      style={{
        opacity: interpolate(
          f,
          [0, 14, frames - 14, frames - 1],
          [0, 1, 1, 0],
          clamp,
        ),
      }}
    >
      {children}
    </AbsoluteFill>
  );
};
const FrameLabel: React.FC<{ chapter: string }> = ({ chapter }) => (
  <>
    <div className="chapter">{chapter}</div>
    <div className="film-mark">agus.</div>
  </>
);
const Disclosure = () => (
  <div className="disclosure">
    <span className="disclosure-dot" /> OFFLINE PARSER · FIXTURE DEMO{" "}
    <span className="sep">/</span> NO LIVE AI{" "}
    <span className="footnote">Fictional data · No real funds moved</span>
  </div>
);
const Plate: React.FC<{ shot: string; frames: number; wide: boolean }> = ({
  shot,
  frames,
  wide,
}) => {
  const f = useCurrentFrame();
  const meta = evidence.shots.find((s) => s.name === shot)!;
  const playing = Math.min(Math.floor(meta.duration * FPS) - 3, frames - 36);
  const entry = spring({
    fps: FPS,
    frame: f,
    config: { damping: 28, stiffness: 100 },
  });
  return (
    <div
      className={`plate ${wide ? "wide" : ""}`}
      style={{
        transform: `translateY(${(1 - entry) * 36}px) scale(${1 + ease(f, 0, frames) * 0.006})`,
        opacity: ease(f, 4, 18),
      }}
    >
      <div className="window-bar">
        <div className="window-dots">
          <i />
          <i />
          <i />
        </div>
        <span>agus. / financial workspace</span>
        <b>ACTUAL PRODUCT CAPTURE</b>
      </div>
      <div
        style={{
          aspectRatio: "1280 / 800",
          position: "relative",
          background: "#000",
          overflow: "hidden",
        }}
      >
        <Sequence durationInFrames={playing} layout="none">
          <OffthreadVideo
            src={staticFile(`captures/${shot}.mp4`)}
            muted
            style={{ width: "100%", height: "100%", display: "block" }}
          />
        </Sequence>
        <Sequence from={playing} layout="none">
          <Img
            src={staticFile(`captures/${shot}.png`)}
            style={{
              width: "100%",
              height: "100%",
              display: "block",
              transform: /03-|04-|05-|06-|07-|08-|10-|12-|13-|14-/.test(shot)
                ? `scale(${1 + ease(f, playing, Math.max(1, frames - playing - 24)) * (/03-|04-/.test(shot) ? 0.28 : 0.14)})`
                : undefined,
              transformOrigin: "66% 32%",
            }}
          />
        </Sequence>
      </div>
    </div>
  );
};
const Product: React.FC<{ scene: any }> = ({ scene }) => {
  const f = useCurrentFrame(),
    frames = scene.seconds * FPS,
    wide = scene.layout === "wide";
  return (
    <Fade frames={frames}>
      <Atmosphere frame={f} />
      <FrameLabel chapter={scene.chapter} />
      {wide ? (
        <>
          <div className="wide-heading" style={{ opacity: ease(f, 0, 20) }}>
            {scene.title.replaceAll("\n", " ")}
          </div>
          <div className="wide-body">{scene.body}</div>
        </>
      ) : (
        <div
          className="editorial"
          style={{
            opacity: ease(f, 5, 22),
            transform: `translateY(${(1 - ease(f, 5, 30)) * 20}px)`,
          }}
        >
          <div className="small-rule" />
          <h1>{scene.title}</h1>
          <p>{scene.body}</p>
          <div className="fact-tag">{scene.tag}</div>
        </div>
      )}
      <Plate shot={scene.shot} frames={frames} wide={wide} />
      {wide && <div className="wide-tag">{scene.tag}</div>}
      <EditorialEvidence shot={scene.shot} frame={f} />
      <Disclosure />
      <div
        className="scene-progress"
        style={{ width: `${100 * ease(f, 0, frames)}%` }}
      />
    </Fade>
  );
};
const EditorialEvidence: React.FC<{ shot: string; frame: number }> = ({
  shot,
  frame,
}) => {
  const show = ease(frame, /12-/.test(shot) ? 10 : 90, 22);
  const style = {
    opacity: show,
    transform: `translateY(${(1 - show) * 14}px)`,
  };
  if (shot === "03-food" || shot === "04-totals")
    return (
      <div className="ledger-focus" style={style}>
        <div className="focus-label">
          FICTIONAL LEDGER · FIGURES FROM THE CAPTURE
        </div>
        {shot === "03-food" ? (
          <div className="figure-pair">
            <div>
              <span>Food spending</span>
              <strong>₦36,600</strong>
            </div>
            <p>
              All saved dates.
              <br />
              Seeded sample data.
            </p>
          </div>
        ) : (
          <div className="figure-pair">
            <div>
              <span>Income</span>
              <strong>₦300,000</strong>
            </div>
            <div>
              <span>Expenses</span>
              <strong>₦131,600</strong>
            </div>
          </div>
        )}
      </div>
    );
  if (shot === "12-outcomes")
    return (
      <div className="outcome-focus" style={style}>
        <div>
          <span>Ada Okafor · ₦500</span>
          <strong>✓ Successful</strong>
        </div>
        <div>
          <span>Chidi Nwosu · ₦700</span>
          <strong>◷ Processing</strong>
        </div>
      </div>
    );
  const note: Record<string, string> = {
    "02-welcome": "Ask → Prepare → Review → Follow through",
    "07-partial": "Missing account? Keep it empty.",
    "08-details": "Two recipients. One editable draft.",
    "10-verify": "Verification ≠ approval ≠ submission.",
    "11-approval": "Submit separately. Always.",
    "13-pending": "Uncertain does not mean successful.",
  };
  return note[shot] ? (
    <div className="editorial-note" style={style}>
      {note[shot]}
    </div>
  ) : null;
};
const Intro = () => {
  const f = useCurrentFrame();
  const beats = [
    { start: 0, end: 72, text: "You sent the money." },
    { start: 72, end: 144, text: "But did it arrive?" },
    { start: 144, end: 264, text: "And when you’re paying\nseveral people?" },
  ];
  return (
    <Fade frames={15 * FPS}>
      <Atmosphere frame={f} />
      <FrameLabel chapter="HACKAHOLICS 7.0 / AGUS" />
      <div
        className="intro-orbit"
        style={{
          transform: `translate(-50%,-50%) rotate(${f / 10}deg)`,
          opacity: 0.15,
        }}
      >
        <i />
        <i />
        <i />
      </div>
      {beats.map((b, i) =>
        f >= b.start && f < b.end ? (
          <div
            key={i}
            className="hook-copy"
            style={{
              opacity: interpolate(
                f,
                [b.start, b.start + 10, b.end - 10, b.end - 1],
                [0, 1, 1, 0],
                clamp,
              ),
              transform: `translateY(${(1 - ease(f, b.start, 20)) * 18}px)`,
            }}
          >
            {b.text}
          </div>
        ) : null,
      )}
      {f >= 264 && (
        <div
          className="brand-lockup"
          style={{
            opacity: ease(f, 264, 20),
            transform: `translateY(${(1 - ease(f, 264, 28)) * 18}px)`,
          }}
        >
          <Wordmark />
          <p>A clearer way to follow through.</p>
        </div>
      )}
      <div className="intro-bottom">
        Offline parser · Fixture simulation · No live AI or real money movement
      </div>
    </Fade>
  );
};
const Outro = () => {
  const f = useCurrentFrame();
  const brandOpacity = interpolate(f, [0, 16, 128, 148], [0, 1, 1, 0], clamp);
  const creditOpacity = ease(f, 144, 18);
  return (
    <AbsoluteFill>
      <Atmosphere frame={f} />
      <div
        className="closing-brand"
        style={{
          opacity: brandOpacity,
          transform: `translateY(${(1 - ease(f, 0, 30)) * 20}px)`,
        }}
      >
        <Wordmark size={270} />
        <p>Your money, and what's next.</p>
      </div>
      <div
        className="credit-slate"
        style={{
          opacity: creditOpacity,
          transform: `translateY(${(1 - ease(f, 144, 28)) * 16}px)`,
        }}
      >
        <div className="credit-kicker">A PROJECT BY</div>
        <div className="aporia-wordmark">APORIA</div>
        <div className="credit-rule" />
        <div className="credit-names">Gerald · Francis · Lucy</div>
        <div className="credit-event">HACKAHOLICS 7.0 · 2026</div>
      </div>
      <div className="closing-disclosure">
        Offline parser · Fictional ledger · Simulated payments
        <br />
        No live AI. No real funds moved.
      </div>
    </AbsoluteFill>
  );
};
export const AgusFilm: React.FC = () => {
  let start = 0;
  return (
    <AbsoluteFill
      style={{
        background: "#050607",
        fontFamily: "Film Sans, sans-serif",
        color: "#f6f6f4",
      }}
    >
      {scenes.map((scene, i) => {
        const from = start;
        start += scene.seconds * FPS;
        return (
          <Sequence
            key={i}
            from={from}
            durationInFrames={scene.seconds * FPS}
            name={scene.kind === "product" ? (scene as any).shot : scene.kind}
          >
            {scene.kind === "intro" ? (
              <Intro />
            ) : scene.kind === "outro" ? (
              <Outro />
            ) : (
              <Product scene={scene} />
            )}
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
