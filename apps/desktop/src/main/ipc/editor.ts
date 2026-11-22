/**
 * IPC handlers for the video editor (trim, intro/outro, fades, export,
 * publish to c0mpute private storage).
 */

import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type WebContents } from 'electron';
import { join, relative, resolve, isAbsolute } from 'path';
import { RenderCancelled } from '@pairux/video-edit/node';
import { getRecordingsDirectory } from '../recording';
import { getFFmpegPath } from '../streaming';
import { EditorService, IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, listVideoFiles } from '../editor';
import { allowMediaPath, isMediaPathAllowed } from '../editor/mediaProtocol';
import { downloadCloudRecording, isAllowedCloudUrl } from '../editor/cloud';

let service: EditorService | null = null;

export function getEditorService(): EditorService {
  service ??= new EditorService({
    ffmpegPath: getFFmpegPath,
    cacheDir: () => join(app.getPath('userData'), 'edit-cache'),
    outputDir: getRecordingsDirectory,
  });
  return service;
}

function inside(dir: string, path: string): boolean {
  const rel = relative(resolve(dir), resolve(path));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/** A path the renderer may act on: listed in the recordings dir, or picked/produced this run. */
function permitted(path: unknown): path is string {
  if (typeof path !== 'string' || !path) return false;
  return inside(getRecordingsDirectory(), path) || isMediaPathAllowed(path);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function send(sender: WebContents, channel: string, data: unknown): void {
  if (!sender.isDestroyed()) sender.send(channel, data);
}

const ext = (list: string[]) => list.map((e) => e.slice(1));

export function registerEditorHandlers(): void {
  const editor = getEditorService();

  ipcMain.handle('editor:listRecordings', () => {
    const dir = getRecordingsDirectory();
    return { dir, files: listVideoFiles(dir) };
  });

  ipcMain.handle('editor:pickFile', async (event, args: { kind: 'video' | 'image' | 'media' }) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const filters =
      args.kind === 'image'
        ? [{ name: 'Images', extensions: ext(IMAGE_EXTENSIONS) }]
        : args.kind === 'video'
          ? [{ name: 'Videos', extensions: ext(VIDEO_EXTENSIONS) }]
          : [
              {
                name: 'Videos and images',
                extensions: ext([...VIDEO_EXTENSIONS, ...IMAGE_EXTENSIONS]),
              },
            ];
    const options = {
      title: args.kind === 'image' ? 'Choose an image' : 'Choose a video',
      defaultPath: getRecordingsDirectory(),
      properties: ['openFile' as const],
      filters,
    };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    const path = result.canceled ? undefined : result.filePaths[0];
    if (!path) return null;
    return { path, url: allowMediaPath(path) };
  });

  ipcMain.handle('editor:open', async (_event, args: { path: string }) => {
    if (!permitted(args.path)) return { success: false, error: 'Open that file with "Open file…"' };
    try {
      const opened = await editor.open(args.path);
      allowMediaPath(opened.sourcePath);
      return { success: true, ...opened, url: allowMediaPath(opened.editPath) };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle('editor:probe', async (_event, args: { path: string }) => {
    if (!permitted(args.path)) return { success: false, error: 'Not allowed' };
    try {
      return { success: true, info: await editor.probe(args.path) };
    } catch (error) {
      return { success: false, error: errorMessage(error) };
    }
  });

  ipcMain.handle(
    'editor:pickOutput',
    async (event, args: { format: 'mp4' | 'webm'; suggested?: string }) => {
      const win = BrowserWindow.fromWebContents(event.sender);
      const options = {
        title: 'Export edited video',
        defaultPath: args.suggested ?? join(getRecordingsDirectory(), `PairUX-edit.${args.format}`),
        filters: [
          args.format === 'webm'
            ? { name: 'WebM Video', extensions: ['webm'] }
            : { name: 'MP4 Video', extensions: ['mp4'] },
        ],
      };
      const result = win
        ? await dialog.showSaveDialog(win, options)
        : await dialog.showSaveDialog(options);
      if (result.canceled || !result.filePath) return null;
      allowMediaPath(result.filePath);
      return { path: result.filePath };
    }
  );

  ipcMain.handle(
    'editor:render',
    async (
      event,
      args: {
        plan: unknown;
        source: string;
        sourcePath?: string;
        output?: string | null;
        quality?: 'fast' | 'balanced' | 'high';
        sourceDuration?: number | null;
      }
    ) => {
      if (!permitted(args.source)) return { success: false, error: 'Open the recording first' };
      if (args.output && !permitted(args.output))
        return { success: false, error: 'Choose where to save with Save as…' };
      const plan = (args.plan ?? {}) as {
        intro?: { source?: unknown } | null;
        outro?: { source?: unknown } | null;
      };
      for (const b of [plan.intro, plan.outro]) {
        if (b?.source !== undefined && !permitted(b.source))
          return { success: false, error: 'Pick intro/outro files with the file picker' };
      }
      try {
        const result = await editor.render(args.plan, args, (p) => {
          send(event.sender, 'editor:progress', p);
        });
        return { success: true, ...result, url: allowMediaPath(result.output) };
      } catch (error) {
        if (error instanceof RenderCancelled)
          return { success: false, cancelled: true, error: 'Export cancelled' };
        return { success: false, error: errorMessage(error) };
      }
    }
  );

  ipcMain.handle('editor:cancelRender', () => ({ cancelled: editor.cancelRender() }));

  ipcMain.handle('editor:showInFolder', (_event, args: { path: string }) => {
    if (!permitted(args.path)) return { success: false };
    shell.showItemInFolder(args.path);
    return { success: true };
  });

  ipcMain.handle('editor:openFile', async (_event, args: { path: string }) => {
    if (!permitted(args.path)) return { success: false };
    const error = await shell.openPath(args.path);
    return { success: !error };
  });

  ipcMain.handle('editor:copyText', (_event, args: { text: string }) => {
    clipboard.writeText(typeof args.text === 'string' ? args.text.slice(0, 4096) : '');
    return { success: true };
  });

  ipcMain.handle('editor:c0mputeStatus', () => editor.c0mputeStatus());

  ipcMain.handle('editor:publish', async (event, args: { path: string; password?: string }) => {
    if (!permitted(args.path)) return { success: false, error: 'Export the video first' };
    try {
      const result = await editor.publish(args.path, args.password, (line) => {
        send(event.sender, 'editor:publishLine', { line });
      });
      return { success: true, ...result };
    } catch (error) {
      if (error instanceof RenderCancelled)
        return { success: false, cancelled: true, error: 'Publish cancelled' };
      const message = errorMessage(error);
      return { success: false, error: message, locked: /locked/i.test(message) };
    }
  });

  ipcMain.handle('editor:cancelPublish', () => ({ cancelled: editor.cancelPublish() }));

  ipcMain.handle(
    'editor:downloadCloud',
    async (event, args: { url: string; title?: string | null }) => {
      if (!isAllowedCloudUrl(args.url))
        return { success: false, error: 'That link is not a PairUX recording' };
      try {
        const path = await downloadCloudRecording(
          args.url,
          args.title ?? null,
          getRecordingsDirectory(),
          {
            onProgress: (received, total) => {
              send(event.sender, 'editor:downloadProgress', { received, total });
            },
          }
        );
        allowMediaPath(path);
        return { success: true, path };
      } catch (error) {
        return { success: false, error: errorMessage(error) };
      }
    }
  );
}
