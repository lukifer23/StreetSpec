import { app, BrowserWindow, shell } from 'electron'
import { release } from 'node:os'
import { join, resolve } from 'node:path' // Use resolve for absolute paths

// The built directory structure
//
// ├── dist-electron
// │   ├── main.js
// │   ├── preload.js
// │   └── ...other-support-files
// ├── dist
// │   ├── index.html
// │   ├── assets
// │   └── ...other-static-files
// └──

// Use __dirname which is reliable in CommonJS module context (main process)
process.env.DIST_ELECTRON = join(__dirname, '..')
process.env.DIST = join(process.env.DIST_ELECTRON, '../dist')
process.env.VITE_PUBLIC = process.env.VITE_DEV_SERVER_URL
  ? join(process.env.DIST_ELECTRON, '../public')
  : process.env.DIST

// Disable GPU Acceleration for Windows 7
if (release().startsWith('6.1')) app.disableHardwareAcceleration()

// Set application name for Windows 10+ notifications
if (process.platform === 'win32') app.setAppUserModelId(app.getName())

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

let win: BrowserWindow | null = null
// Point to the tsc output directory and .js file for preload
const preload = join(__dirname, '../preload/preload.js')
const url = process.env.VITE_DEV_SERVER_URL // URL provided by Vite dev server
const indexHtml = join(process.env.DIST, 'index.html') // Path to renderer built file

async function createWindow() {
  win = new BrowserWindow({
    title: 'PoleCheck Desktop',
    icon: join(process.env.VITE_PUBLIC, 'vite.svg'), // Default Vite icon path
    width: 1200,
    height: 800,
    webPreferences: {
      preload,
      nodeIntegration: false,
      contextIsolation: true,
    },
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    await win.loadURL(url) // Use await for async operation
    win.webContents.openDevTools() // Open dev tools in dev mode
  } else {
    await win.loadFile(indexHtml) // Use await for async operation
  }

  // Test actively push message to the Electron-Renderer
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', new Date().toLocaleString())
  })

  // Make all links open with the browser, not with the application
  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    if (targetUrl.startsWith('https:')) shell.openExternal(targetUrl)
    return { action: 'deny' }
  })

  win.on('closed', () => {
    win = null
  })
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  win = null
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('activate', () => {
  const allWindows = BrowserWindow.getAllWindows()
  if (allWindows.length) {
    allWindows[0].focus()
  } else {
    createWindow()
  }
}) 