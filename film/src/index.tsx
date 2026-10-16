import React from "react";
import { Composition, registerRoot } from "remotion";
import { AgusFilm } from "./movie";
import { FPS, TOTAL_FRAMES } from "./scenes";
const Root = () => (
  <Composition
    id="AgusFilm"
    component={AgusFilm}
    width={1920}
    height={1080}
    fps={FPS}
    durationInFrames={TOTAL_FRAMES}
  />
);
registerRoot(Root);
