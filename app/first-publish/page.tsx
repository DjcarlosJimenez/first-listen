import type { Metadata } from "next";
import { FirstPublishForm } from "@/components/first-publish-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "Publica tu primera canción o video en First Listen sin crear contraseña.",
  title: "Publica tu primera canción | First Listen",
};

export default function FirstPublishPage() {
  return <FirstPublishForm />;
}
