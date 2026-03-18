import { contextBridge, ipcRenderer } from 'electron'

const electronApi = {
  chooseExportPath: () => ipcRenderer.invoke('file:chooseExportPath') as Promise<string | null>,
  savePng: (filePath: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('file:savePng', {
      filePath,
      bytes: Array.from(bytes),
    }) as Promise<{ ok: boolean; filePath: string }>,
}

contextBridge.exposeInMainWorld('electronApi', electronApi)
