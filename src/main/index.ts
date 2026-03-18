import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const createWindow = async () => {
  const win = new BrowserWindow({
    width: 1600,
    height: 980,
    minWidth: 1100,
    minHeight: 760,
    backgroundColor: '#111827',
    webPreferences: {
      preload: path.join(__dirname, 'index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  const devServerUrl = process.env.VITE_DEV_SERVER_URL
  if (devServerUrl) {
    await win.loadURL(devServerUrl)
    win.webContents.openDevTools({ mode: 'detach' })
    return
  }

  await win.loadFile(path.join(__dirname, '../dist/index.html'))
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

ipcMain.handle('file:chooseExportPath', async () => {
  const result = await dialog.showSaveDialog({
    title: '导出 PNG',
    defaultPath: 'untitled.png',
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  return result.filePath
})

ipcMain.handle(
  'file:savePng',
  async (_event, payload: { filePath: string; bytes: number[] }) => {
    const dir = path.dirname(payload.filePath)
    await mkdir(dir, { recursive: true })
    await writeFile(payload.filePath, Buffer.from(payload.bytes))
    return { ok: true, filePath: payload.filePath }
  },
)

ipcMain.handle('project:chooseSavePath', async () => {
  const result = await dialog.showSaveDialog({
    title: '保存工程',
    defaultPath: 'untitled.pslite',
    filters: [{ name: 'PS Lite Project', extensions: ['pslite'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation'],
  })

  if (result.canceled || !result.filePath) {
    return null
  }

  return result.filePath
})

ipcMain.handle('project:open', async () => {
  const result = await dialog.showOpenDialog({
    title: '打开工程',
    filters: [{ name: 'PS Lite Project', extensions: ['pslite'] }],
    properties: ['openFile'],
  })

  const filePath = result.filePaths[0]
  if (result.canceled || !filePath) {
    return null
  }

  const content = await readFile(filePath, 'utf8')
  return { filePath, content }
})

ipcMain.handle(
  'project:save',
  async (_event, payload: { filePath: string; content: string }) => {
    const dir = path.dirname(payload.filePath)
    await mkdir(dir, { recursive: true })
    await writeFile(payload.filePath, payload.content, 'utf8')
    return { ok: true, filePath: payload.filePath }
  },
)
