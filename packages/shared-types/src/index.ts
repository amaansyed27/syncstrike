export interface Team {
  code: string;
  name: string;
  totalScore: number;
}

export interface Question {
  id: string;
  text: string;
  answer: string;
  isComplete: boolean;
  winnerCode?: string;
  winnerName?: string;
}

export interface BuzzEvent {
  teamCode: string;
  questionId: string;
}

export interface LeaderboardEntry {
  teamCode: string;
  teamName: string;
  hitTime: number;
  rank: number;
  isWrong: boolean;
}

export type BuzzerState = 'LOCKED' | 'LIVE' | 'JUDGING';
export type ProjectorView = 'home' | 'reaction' | 'accuracy';

export interface GameState {
  buzzerState: BuzzerState;
  activeQuestion: Question | null;
  endTime?: number;
  projectorView: ProjectorView;
}

// Server to client events
export interface ServerToClientEvents {
  state_update: (data: GameState) => void;
  leaderboard_update: (data: { leaderboard: LeaderboardEntry[] }) => void;
  answering_team: (data: { team: LeaderboardEntry | null }) => void;
  buzz_locked: (data: { reason: string }) => void;
  buzz_acknowledged: () => void;
}

// Client to server events
export interface ClientToServerEvents {
  buzz: (data: BuzzEvent) => void;
  join_room: (data: { role: 'participant' | 'projector' | 'organizer'; teamCode?: string }) => void;
}
