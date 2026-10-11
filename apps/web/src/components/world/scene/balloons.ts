import { CanvasTexture, SRGBColorSpace } from "three";

import type { Balloon } from "../definition/types";
import { palette } from "./palette";

const textures = new Map<Balloon, CanvasTexture>();

/** One shared texture per balloon kind, drawn once on first use. */
export function balloonTexture(kind: Balloon): CanvasTexture {
  const cached = textures.get(kind);
  if (cached !== undefined) return cached;
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d")!;
  context.beginPath();
  context.arc(size / 2, size / 2, size / 2 - 6, 0, Math.PI * 2);
  context.fillStyle = kind === "approval" ? palette.approval : palette.question;
  context.fill();
  context.lineWidth = 8;
  context.strokeStyle = palette.balloonRim;
  context.stroke();
  context.fillStyle = palette.balloonText;
  context.font = "bold 76px system-ui, sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(kind === "approval" ? "!" : "?", size / 2, size / 2 + 4);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  textures.set(kind, texture);
  return texture;
}
