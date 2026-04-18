export type ToolType = 'move' | 'brush' | 'eraser' | 'eyedropper' | 'fill' | 'crop' | 'text'
export type LayerKind = 'bitmap' | 'text'

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

export interface TextLayerData {
  content: string
  fontSize: number
  color: string
  fontFamily: string
}

export interface LayerSnapshot {
  id: string
  name: string
  type: LayerKind
  visible: boolean
  opacity: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  scaleX: number
  scaleY: number
  rotation: number
  textData: TextLayerData | null
  imageData: ImageData
}

export interface LayerModel {
  id: string
  name: string
  type: LayerKind
  visible: boolean
  opacity: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  scaleX: number
  scaleY: number
  rotation: number
  textData: TextLayerData | null
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
  type?: LayerKind
  visible: boolean
  opacity: number
  width: number
  height: number
  offsetX: number
  offsetY: number
  scale?: number
  scaleX?: number
  scaleY?: number
  rotation: number
  textData?: TextLayerData | null
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
