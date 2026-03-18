export {}

declare global {
  interface Window {
    electronApi?: {
      chooseExportPath: () => Promise<string | null>
      savePng: (filePath: string, bytes: Uint8Array) => Promise<{ ok: boolean; filePath: string }>
    }
  }
}
