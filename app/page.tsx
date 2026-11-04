import Home from "@/components/Home";
import { homePosters } from "@/lib/tmdb";

export const revalidate = 86_400;

export default async function Page() {
  return <Home posters={await homePosters()} />;
}
