// 쪽에 붙일 그림 만들기: 갤러리 사진 고르기, 클립보드에 복사한 사진, 그림 스티커.
// 큰 사진은 긴 변 1600px로 줄여 data URI(JPEG, 투명한 PNG는 PNG)로 — 획(Stroke)에 그대로 담겨 저장·동기화·PDF 내보내기가 된다.
import { ImageFormat, PaintStyle, Skia, StrokeCap, StrokeJoin } from "@shopify/react-native-skia";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";

import type { Sticker } from "./stickers";

/** 넣을 그림: data URI와 픽셀 크기 */
export type Picture = { uri: string; w: number; h: number };

const MAX_SIDE = 1600;
/** PNG가 이보다 크면 JPEG로 (스크린숏처럼 큰 PNG가 동기화를 무겁게 하지 않게) */
const PNG_MAX_B64 = 1_200_000;

/** 그림을 풀어 너무 크면 줄인다. 못 푸는 형식이면 null */
export function shrinkDataUri(dataUri: string, maxSide = MAX_SIDE): Picture | null {
  const b64 = dataUri.slice(dataUri.indexOf(",") + 1);
  const img = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(b64));
  if (!img) return null;
  const w0 = img.width(), h0 = img.height();
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const png = dataUri.startsWith("data:image/png");
  const ok = png || dataUri.startsWith("data:image/jpeg") || dataUri.startsWith("data:image/jpg");
  if (k === 1 && ok && b64.length <= PNG_MAX_B64) return { uri: dataUri, w: w0, h: h0 };
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const surface = Skia.Surface.Make(w, h);
  if (!surface) return null;
  const c = surface.getCanvas();
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  const draw = (bg: boolean) => {
    c.clear(Skia.Color(bg ? "#FFFFFF" : "transparent"));
    c.drawImageRect(img, Skia.XYWHRect(0, 0, w0, h0), Skia.XYWHRect(0, 0, w, h), paint);
    return surface.makeImageSnapshot();
  };
  if (png) {
    const out = draw(false).encodeToBase64(ImageFormat.PNG, 100);
    if (out.length <= PNG_MAX_B64) return { uri: `data:image/png;base64,${out}`, w, h };
  }
  // JPEG은 투명한 곳이 검게 나오므로 흰 바탕 위에
  return { uri: `data:image/jpeg;base64,${draw(true).encodeToBase64(ImageFormat.JPEG, 82)}`, w, h };
}

/** 갤러리에서 사진 하나 고르기. 그만두면 null, 못 여는 형식이면 오류 */
export async function pickPhoto(): Promise<Picture | null> {
  const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.85, base64: true, allowsMultipleSelection: false });
  if (r.canceled || !r.assets?.length) return null;
  const a = r.assets[0];
  const uri = a.base64 ? `data:${a.mimeType && a.mimeType.startsWith("image/") ? a.mimeType : "image/jpeg"};base64,${a.base64}` : a.uri;
  if (!uri.startsWith("data:image/")) throw new Error("사진을 읽지 못했어요.");
  const p = shrinkDataUri(uri);
  if (!p) throw new Error("이 사진 형식은 넣을 수 없어요. (JPG·PNG 사진을 골라 주세요)");
  return p;
}

/** 클립보드에 복사한 사진. 사진이 없으면 null */
export async function clipboardPicture(): Promise<Picture | null> {
  if (!(await Clipboard.hasImageAsync())) return null;
  const got = await Clipboard.getImageAsync({ format: "png" });
  if (!got?.data) return null;
  const uri = got.data.startsWith("data:") ? got.data : `data:image/png;base64,${got.data}`;
  return shrinkDataUri(uri);
}

/** 그림 스티커를 PNG 그림으로 (size×size 픽셀, 투명 바탕) */
export function stickerPicture(st: Sticker, size = 240): Picture | null {
  const surface = Skia.Surface.Make(size, size);
  if (!surface) return null;
  const c = surface.getCanvas();
  c.clear(Skia.Color("transparent"));
  c.scale(size / 100, size / 100);
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  for (const part of st.parts) {
    const path = Skia.Path.MakeFromSVGString(part.d);
    if (!path) continue;
    if (part.fill) {
      paint.setStyle(PaintStyle.Fill);
      paint.setColor(Skia.Color(part.fill));
      c.drawPath(path, paint);
    }
    if (part.stroke) {
      paint.setStyle(PaintStyle.Stroke);
      paint.setStrokeWidth(part.width ?? 4);
      paint.setStrokeCap(StrokeCap.Round);
      paint.setStrokeJoin(StrokeJoin.Round);
      paint.setColor(Skia.Color(part.stroke));
      c.drawPath(path, paint);
    }
  }
  const b64 = surface.makeImageSnapshot().encodeToBase64(ImageFormat.PNG, 100);
  return { uri: `data:image/png;base64,${b64}`, w: size, h: size };
}

/** 웹: 붙여넣기(Ctrl+V)로 온 그림 파일 → data URI */
export function fileToDataUri(file: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("그림을 읽지 못했어요."));
    r.readAsDataURL(file);
  });
}
