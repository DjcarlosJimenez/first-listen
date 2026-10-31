/* eslint-disable @next/next/no-img-element */
import { ImageResponse } from "next/og";
import { getFirstPublishLiveSong } from "@/lib/first-publish-live";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ songId: string }> },
) {
  const { songId } = await params;
  const song = await getFirstPublishLiveSong(songId);
  if (!song) return new Response("Not found", { status: 404 });

  return new ImageResponse(
    <div style={{ alignItems: "center", background: "#101510", color: "white", display: "flex", height: "100%", padding: 58, width: "100%" }}>
      <div style={{ background: "#d6ff3f", borderRadius: 36, display: "flex", height: 440, overflow: "hidden", width: 440 }}>
        <img alt="" height="440" src={song.coverImageUrl} style={{ height: "100%", objectFit: "cover", width: "100%" }} width="440" />
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginLeft: 58, width: 590 }}>
        <div style={{ color: "#b9ff2f", display: "flex", fontSize: 24, fontWeight: 800, letterSpacing: 3 }}>FIRST LISTEN</div>
        <div style={{ display: "flex", fontSize: 62, fontWeight: 900, lineHeight: 1.02, marginTop: 30 }}>{song.title}</div>
        <div style={{ color: "#d9dfd3", display: "flex", fontSize: 34, marginTop: 22 }}>{song.artistName}</div>
        <div style={{ alignItems: "center", display: "flex", marginTop: 42 }}>
          <div style={{ background: "#b9ff2f", borderRadius: 999, color: "#111", display: "flex", fontSize: 24, fontWeight: 800, padding: "16px 26px" }}>Escuchar y reaccionar</div>
          <div style={{ color: "#9ca895", display: "flex", fontSize: 21, marginLeft: 22 }}>{song.genre}</div>
        </div>
      </div>
    </div>,
    { height: 630, width: 1200 },
  );
}
