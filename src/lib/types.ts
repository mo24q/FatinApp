export type Phase = 'lobby' | 'reveal' | 'discuss' | 'vote' | 'result';
export type Player = { id: string; name: string; online: boolean; ready: boolean; is_host: boolean };
export type Room = {
  id: string; code: string; phase: Phase; round: number; me: string; is_host: boolean;
  host_offline: boolean; discussion_seconds: number; deadline: string | null;
  timer_version?: number;
  timer?: { enabled: boolean; paused: boolean; remaining_seconds: number | null; duration_seconds: number };
  server_time: string; revision: number; players: Player[]; voted: boolean;
  votes_count: number; my_vote: string | null;
  result: null | { word: string; category: string; outsider_id: string; caught: boolean; tied: boolean;
    votes: { id: string; name: string; count: number }[] };
};
export type Secret = { round: number; outsider: boolean; word: string | null; category: string };
