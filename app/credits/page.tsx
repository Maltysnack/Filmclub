import Link from "next/link";
import Logo from "@/components/Logo";

export const metadata = { title: "Credits" };

export default function Credits() {
  return (
    <main className="column flex min-h-dvh flex-col justify-center gap-5 px-6">
      <Link href="/" aria-label="Filmclub home" className="self-start"><Logo /></Link>
      <h1 className="display text-[38px]">Credits</h1>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/tmdb.svg" alt="TMDB" className="h-4 w-auto self-start" />
      <p className="text-sm leading-relaxed">This product uses the TMDB API but is not endorsed or certified by TMDB. Streaming data from JustWatch.</p>
      <a href="https://maltysnack.github.io" target="_blank" rel="noopener noreferrer" className="label">Made by Maltysnack</a>
      <Link href="/" className="slab mt-4">Back</Link>
    </main>
  );
}
