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

// Type declaration for use in renderer
export type ElectronAPI = typeof electronAPI;
