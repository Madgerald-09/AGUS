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
  useVideoConfig,
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
          ? "radial-gradient(ellipse, #c9d5e0 0%, transparent 62%)"
          : "radial-gradient(ellipse, #26323d66 0%, #15101f44 32%, transparent 64%)",
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
    <span className="disclosure-dot" /> VERIFIED FIXTURE DEMO{" "}
    <span className="sep">/</span> NO LIVE AI{" "}
    <span className="footnote">
      Fictional ledger & recipients · No real funds moved
    </span>
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
              transform: /03-|04-|05-|06-|13-|14-/.test(shot)
                ? `scale(${1 + ease(f, playing, Math.max(1, frames - playing - 24)) * 0.16})`
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
      <Disclosure />
      <div
        className="scene-progress"
        style={{ width: `${100 * ease(f, 0, frames)}%` }}
      />
    </Fade>
  );
};
const Intro = () => {
  const f = useCurrentFrame();
  const stage = f < 108 ? 0 : f < 216 ? 1 : 2;
  return (
    <Fade frames={15 * FPS}>
      <Atmosphere frame={f} />
      <FrameLabel chapter="HACKAHOLICS 7.0 / PRODUCT FILM" />
      <div
        className="intro-orbit"
        style={{
          transform: `translate(-50%,-50%) rotate(${f / 8}deg) scale(${0.75 + ease(f, 150, 120) * 0.25})`,
          opacity: stage === 2 ? 0.3 : 0.13,
        }}
      >
        <i />
        <i />
        <i />
      </div>
      {stage === 0 && (
        <div
          className="intro-copy"
          style={{
            opacity: interpolate(f, [0, 18, 90, 107], [0, 1, 1, 0], clamp),
            transform: `translateY(${(1 - ease(f, 0, 30)) * 28}px)`,
          }}
        >
          Your money.
          <br />
          <span>More than a balance.</span>
        </div>
      )}
      {stage === 1 && (
        <div
          className="intro-copy"
          style={{
            opacity: interpolate(f, [108, 126, 198, 215], [0, 1, 1, 0], clamp),
          }}
        >
          Questions. Decisions.
          <br />
          <span>A clearer next step.</span>
        </div>
      )}
      {stage === 2 && (
        <div
          className="brand-lockup"
          style={{
            opacity: ease(f, 216, 24),
            transform: `translateY(${(1 - ease(f, 216, 36)) * 22}px)`,
          }}
        >
          <Wordmark />
          <p>Your financial workspace.</p>
          <div className="brand-kicker">
            ASK · PREPARE · REVIEW · FOLLOW THROUGH
          </div>
        </div>
      )}
      <div className="intro-bottom">
        A working product demonstration · Fixture mode · No live AI
      </div>
    </Fade>
  );
};
const Outro = () => {
  const f = useCurrentFrame();
  return (
    <Fade frames={14 * FPS}>
      <Atmosphere frame={f} light />
      <FrameLabel chapter="AGUS / HACKAHOLICS 7.0" />
      <div className="outro-wrap">
        <div className="outro-line" style={{ opacity: ease(f, 0, 24) }}>
          A clearer path from
          <br />
          <b>question to next step.</b>
        </div>
        <div
          style={{
            marginTop: 40,
            opacity: ease(f, 26, 25),
            transform: `translateY(${(1 - ease(f, 26, 32)) * 25}px)`,
          }}
        >
          <Wordmark size={260} dark />
        </div>
        <div className="outro-promise">
          Understand the source. Review the details. Stay in control.
        </div>
        <div className="outro-proof">
          <span>FINAL INTERFACE ON MAIN</span>
          <span>WORKING FIXTURE DEMONSTRATION</span>
          <span>HACKAHOLICS 7.0</span>
        </div>
        <p className="outro-disclosure">
          Local payment simulation and fictional ledger data. No real money
          moved.
          <br />
          Offline demonstration parser; genuine Gemini connectivity and external
          integrations are unverified.
        </p>
      </div>
    </Fade>
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
