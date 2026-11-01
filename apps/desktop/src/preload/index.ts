import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { ChannelKey, EventKey, InvokeArgs, InvokeReturn, EventData } from './api';

/**
 * Electron API exposed to the renderer via context bridge.
 * This is the ONLY way the renderer can communicate with the main process.
 */
const electronAPI = {
  /**
   * Invoke an IPC channel and wait for response.
   * Type-safe: channel names and arguments are validated at compile time.
   */
  invoke: <K extends ChannelKey>(channel: K, args: InvokeArgs<K>): Promise<InvokeReturn<K>> => {
    return ipcRenderer.invoke(channel, args);
  },

  /**
   * Subscribe to events from main process.
   * Returns an unsubscribe function.
   */
  on: <K extends EventKey>(channel: K, callback: (data: EventData<K>) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, data: EventData<K>) => {
      callback(data);
    };
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },

  /**
   * Platform information
   */
  platform: process.platform,
};

// Expose API to renderer
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// The agent voice page is a tiny, hidden renderer launched by `pairux voice`
// so the CLI can use Chromium's WebRTC stack without opening the desktop UI.
// Keep its bridge separate from the broad app IPC surface.
contextBridge.exposeInMainWorld('agentVoice', {
  onCommand: (callback: (command: { type: string; payload?: unknown }) => void) => {
    const connect = (_event: IpcRendererEvent, payload: unknown) => {
      callback({ type: 'connect', payload });
    };
    const speak = (_event: IpcRendererEvent, payload: unknown) => {
      callback({ type: 'speak', payload });
    };
    const stop = () => {
      callback({ type: 'stop' });
    };
    ipcRenderer.on('agent-voice:connect', connect);
    ipcRenderer.on('agent-voice:speak', speak);
    ipcRenderer.on('agent-voice:stop', stop);
    return () => {
      ipcRenderer.removeListener('agent-voice:connect', connect);
      ipcRenderer.removeListener('agent-voice:speak', speak);
      ipcRenderer.removeListener('agent-voice:stop', stop);
    };
  },
  send: (event: unknown) => {
    ipcRenderer.send('agent-voice:event', event);
  },
});

// Type declaration for use in renderer
export type ElectronAPI = typeof electronAPI;
