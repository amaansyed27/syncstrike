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

// Server to client events
export interface ServerToClientEvents {
  question_active: (data: { question: Question }) => void;
  question_completed: () => void;
  buzz_locked: (data: { reason: string }) => void;
  buzz_acknowledged: () => void;
  leaderboard_update: (data: { leaderboard: LeaderboardEntry[] }) => void;
  state_update: (data: { isLive: boolean; currentQuestion: Question | null; endTime?: number }) => void;
  answering_team: (data: { team: LeaderboardEntry | null }) => void;
}

// Client to server events
export interface ClientToServerEvents {
  buzz: (data: BuzzEvent) => void;
  join_room: (data: { role: 'participant' | 'projector' | 'organizer'; teamCode?: string }) => void;
}
