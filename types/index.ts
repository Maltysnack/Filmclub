export type SessionMode = "planned" | "live";
export type SessionStatus = "active" | "closed";
export type WatchMode = "home" | "cinema" | "both";

export interface Session {
  id: string;
  code: string;
  mode: SessionMode;
  deadline: string | null;
  threshold: number;
  status: SessionStatus;
  started: boolean;
  watch_mode: WatchMode;
  streaming_services: string[];
  cinema_date: string | null;       // "2026-03-25"
  cinema_time_from: string | null;  // "18:00"
  cinema_time_to: string | null;    // "20:00"
  created_at: string;
}

export interface FilmWithMeta extends Film {
  watch_providers_au: { serviceId: string; name: string }[];
  // Cinema session info — populated when film comes from Dendy pool
  dendyTimes?: string[];
  dendyBookingUrls?: Record<string, string>;
  dendyMatch?: "high" | "low" | "none";
}

export interface Participant {
  id: string;
  session_id: string;
  name: string;
  created_at: string;
}

export interface Film {
  id: string;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string | null;
  release_year: number | null;
  runtime: number | null;
  genres: { id: number; name: string }[];
  film_cast: { name: string; character: string; profile_path: string | null }[];
  rating: number | null;
  watch_providers_au: { serviceId: string; name: string }[];
}

export interface SessionFilm {
  id: string;
  session_id: string;
  film_id: string;
  added_by: string | null;
  film: Film;
}

export interface Swipe {
  id: string;
  session_id: string;
  participant_id: string;
  film_id: string;
  liked: boolean;
}

export interface Match {
  id: string;
  session_id: string;
  film_id: string;
  score: number;
  matched_at: string;
  film?: Film;
}

export interface TMDBMovie {
  id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  overview: string;
  release_date: string;
  vote_average: number;
  genre_ids: number[];
}

export interface TMDBMovieDetail extends TMDBMovie {
  runtime: number;
  genres: { id: number; name: string }[];
  credits?: {
    cast: { name: string; character: string; profile_path: string | null }[];
  };
}
