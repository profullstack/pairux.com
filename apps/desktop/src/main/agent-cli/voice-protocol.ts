export interface VoiceIceServer {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface AgentVoiceRunOptions {
  participantId: string;
  displayName: string;
  token: string;
  url: string;
  iceServers?: VoiceIceServer[];
  speechUrl: string;
  speechToken: string;
  ttsEngine: string;
  ttsVoice: string;
  ttsLocale: string;
  sttModel: string;
  language?: string;
  json: boolean;
  out: (line: string) => void;
  err: (line: string) => void;
  heartbeat: () => Promise<void>;
}
