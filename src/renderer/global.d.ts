export {}

declare global {
  interface Window {
    electronApi?: {
      chooseExportPath: () => Promise<string | null>
      savePng: (filePath: string, bytes: Uint8Array) => Promise<{ ok: boolean; filePath: string }>
      chooseProjectSavePath: () => Promise<string | null>
      openProject: () => Promise<{ filePath: string; content: string } | null>
      saveProject: (filePath: string, content: string) => Promise<{ ok: boolean; filePath: string }>
    }
  }
}
