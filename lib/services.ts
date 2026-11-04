// Australia only at launch. Logo paths come from TMDB's provider list.
export interface Service {
  id: string;
  name: string;
  tmdbId: number;
  logo: string;
}

export const SERVICES: Service[] = [
  { id: "netflix", name: "Netflix", tmdbId: 8, logo: "/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg" },
  { id: "stan", name: "Stan", tmdbId: 21, logo: "/sSfxJXq7s8oHf3XWd0FtqagPDsF.jpg" },
  { id: "binge", name: "Binge", tmdbId: 385, logo: "/7QX5OdsQZrXGNBKq9SPzoPV9OYQ.jpg" },
  { id: "disney_plus", name: "Disney+", tmdbId: 337, logo: "/97yvRBw1GzX7fXprcF80er19ot.jpg" },
  { id: "amazon_prime_video", name: "Prime Video", tmdbId: 119, logo: "/pvske1MyAoymrs5bguRfVqYiM9a.jpg" },
  { id: "apple_tv", name: "Apple TV+", tmdbId: 350, logo: "/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg" },
  { id: "paramount_plus", name: "Paramount+", tmdbId: 531, logo: "/h5DcR0J2EESLitnhR8xLG1QymTE.jpg" },
  { id: "max", name: "Max", tmdbId: 1899, logo: "/jbe4gVSfRlbPTdESXhEKpornsfu.jpg" },
];

export const REGION = "AU";
export const serviceById = (id: string) => SERVICES.find((s) => s.id === id);
export const logoUrl = (path: string) => `https://image.tmdb.org/t/p/w154${path}`;
