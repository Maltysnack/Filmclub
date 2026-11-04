export type Status = "lobby" | "swiping" | "deciding" | "closed";

export interface Session {
  id: string;
  code: string;
  status: Status;
  character_set: string;
  services: string[];
  game: number;
  swipe_deadline: string | null;
  winner_film_id: number | null;
  reveal_film_ids: number[];
  created_at: string;
}

export interface Participant {
  id: string;
  session_id: string;
  user_id: string | null;
  name: string;
  is_bot: boolean;
  is_host: boolean;
  ready: boolean;
  rematch: boolean;
  joined_at: string;
}

export interface Film {
  id: number;
  title: string;
  year: number | null;
  overview: string;
  poster: string;
  genres: number[];
  language: string;
  rating: number;
  popularity: number;
  family: string;
  services: string[];
}

export interface Swipe {
  participant_id: string;
  film_id: number;
  liked: boolean;
}

export interface Round {
  id: string;
  session_id: string;
  number: number;
  film_ids: number[];
  deadline: string;
  resolved: boolean;
}

export interface Mark {
  round_id: string;
  participant_id: string;
  cross_id: number | null;
  tick_id: number;
}
