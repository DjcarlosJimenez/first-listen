import type { Metadata } from "next";
import { FirstPublishForm } from "@/components/first-publish-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "Comparte el enlace de tu primera canción o video en FirstListen sin subir archivos ni conectar tu canal.",
  title: "Comparte el enlace de tu canción | FirstListen",
};

export default function FirstPublishPage() {
  return <FirstPublishForm />;
}
