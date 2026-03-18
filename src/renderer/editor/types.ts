export type ToolType = 'move' | 'brush' | 'eraser' | 'eyedropper' | 'fill' | 'crop'

export interface Point {
  x: number
  y: number
}

export interface CropRect {
  x: number
  y: number
  width: number
  height: number
}

export interface LayerSnapshot {
  id: string
  name: string
  visible: boolean
  opacity: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  scale: number
  rotation: number
  imageData: ImageData
}

export interface LayerModel {
  id: string
  name: string
  visible: boolean
  opacity: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  scale: number
  rotation: number
  canvas: HTMLCanvasElement
}

export interface HistorySnapshot {
  width: number
  height: number
  currentLayerId: string
  layers: LayerSnapshot[]
}

export interface EditorTask {
  id: string
  name: string
  canvasWidth: number
  canvasHeight: number
  layers: LayerModel[]
  currentLayerId: string
  zoom: number
  panX: number
  panY: number
  pendingCrop: CropRect | null
  hoverPoint: Point | null
  renderVersion: number
  lastExportPath: string | null
  history: HistorySnapshot[]
  future: HistorySnapshot[]
}

export interface ClipboardLayer {
  name: string
  snapshot: LayerSnapshot
}

export interface ProjectLayerData {
  id: string
  name: string
  visible: boolean
  opacity: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  scale: number
  rotation: number
  image: string
}

export interface ProjectTaskData {
  id: string
  name: string
  canvasWidth: number
  canvasHeight: number
  currentLayerId: string
  lastExportPath: string | null
  layers: ProjectLayerData[]
}

export interface ProjectFileData {
  version: 1
  activeTaskId: string
  tasks: ProjectTaskData[]
}
