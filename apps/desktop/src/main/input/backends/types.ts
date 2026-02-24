import type { InputEvent } from '@pairux/shared-types';

export interface InputBackendInitResult {
  screenWidth?: number;
  screenHeight?: number;
}

export interface InputBackend {
  readonly name: string;
  readonly supported: boolean;
  readonly reason?: string;
  readonly details?: Record<string, unknown>;
  init(): Promise<InputBackendInitResult | undefined>;
  updateScreenSize(width: number, height: number): void;
  inject(event: InputEvent): Promise<void>;
  emergencyStop(): Promise<void>;
}
