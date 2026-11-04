import Home from "@/components/Home";
import { homePoster } from "@/lib/tmdb";

export const revalidate = 86_400;

export default async function Page() {
  return <Home poster={await homePoster()} />;
}
