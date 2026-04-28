import type {
  EditorTask,
  LayerModel,
  ProjectFileData,
  ProjectLayerData,
  ProjectTaskData,
} from '../types'
import { createLayer, createTextLayer } from './canvas'

const isLikelyBase64 = (value: string) => /^[A-Za-z0-9+/=\s]+$/.test(value) && value.replace(/\s+/g, '').length > 32

const toFileUrl = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, '/')
  return normalized.startsWith('//') ? `file:${normalized}` : `file:///${normalized}`
}

const getImageSourceCandidates = (src: string) => {
  const trimmed = src.trim()
  if (!trimmed) {
    return []
  }

  const candidates = [trimmed]
  if (trimmed.startsWith('data:') || trimmed.startsWith('blob:') || /^https?:\/\//i.test(trimmed)) {
    return candidates
  }

  if (/^[a-zA-Z]:[\\/]/.test(trimmed) || trimmed.startsWith('\\\\')) {
    candidates.unshift(toFileUrl(trimmed))
  }

  if (isLikelyBase64(trimmed)) {
    candidates.unshift(`data:image/png;base64,${trimmed.replace(/\s+/g, '')}`)
  }

  return [...new Set(candidates)]
}

const loadImage = async (src: string) => {
  let lastError: unknown = null
  for (const candidate of getImageSourceCandidates(src)) {
    try {
      const image = new Image()
      image.decoding = 'async'
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('The source image cannot be decoded'))
        image.src = candidate
      })
      return image
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('The source image cannot be decoded')
}

const getLayerVisible = (data: ProjectLayerData) => data.visible ?? true
const getLayerOpacity = (data: ProjectLayerData) => data.opacity ?? 1
const getLayerOffsetX = (data: ProjectLayerData) => data.offsetX ?? 0
const getLayerOffsetY = (data: ProjectLayerData) => data.offsetY ?? 0
const getLayerScaleX = (data: ProjectLayerData) => data.scaleX ?? data.scale ?? 1
const getLayerScaleY = (data: ProjectLayerData) => data.scaleY ?? data.scale ?? 1
const getLayerRotation = (data: ProjectLayerData) => data.rotation ?? 0

const layerToProjectData = (layer: LayerModel): ProjectLayerData => ({
  id: layer.id,
  name: layer.name,
  type: layer.type,
  visible: layer.visible,
  opacity: layer.opacity,
  width: layer.width,
  height: layer.height,
  offsetX: layer.offsetX,
  offsetY: layer.offsetY,
  scaleX: layer.scaleX,
  scaleY: layer.scaleY,
  rotation: layer.rotation,
  textData: layer.textData ? { ...layer.textData } : null,
  image: layer.canvas.toDataURL('image/png'),
})

const taskToProjectData = (task: EditorTask): ProjectTaskData => ({
  id: task.id,
  name: task.name,
  canvasWidth: task.canvasWidth,
  canvasHeight: task.canvasHeight,
  currentLayerId: task.currentLayerId,
  lastExportPath: task.lastExportPath,
  layers: task.layers.map(layerToProjectData),
})

export const serializeProject = (tasks: EditorTask[], activeTaskId: string): ProjectFileData => ({
  version: 1,
  activeTaskId,
  tasks: tasks.map(taskToProjectData),
})

const restoreLayerFromProject = async (data: ProjectLayerData) => {
  if (data.type === 'text' && data.textData) {
    const layer = createTextLayer(data.name, data.id, data.textData, getLayerOffsetX(data), getLayerOffsetY(data))
    layer.visible = getLayerVisible(data)
    layer.opacity = getLayerOpacity(data)
    layer.scaleX = getLayerScaleX(data)
    layer.scaleY = getLayerScaleY(data)
    layer.rotation = getLayerRotation(data)
    return layer
  }

  const layer = createLayer(data.width, data.height, data.name, data.id)
  layer.visible = getLayerVisible(data)
  layer.opacity = getLayerOpacity(data)
  layer.offsetX = getLayerOffsetX(data)
  layer.offsetY = getLayerOffsetY(data)
  layer.scaleX = getLayerScaleX(data)
  layer.scaleY = getLayerScaleY(data)
  layer.rotation = getLayerRotation(data)

  if (typeof data.image === 'string' && data.image.trim()) {
    const image = await loadImage(data.image)
    const ctx = layer.canvas.getContext('2d')
    ctx?.drawImage(image, 0, 0, data.width, data.height)
  }
  return layer
}

export const deserializeProject = async (project: ProjectFileData): Promise<{ tasks: EditorTask[]; activeTaskId: string }> => {
  const tasks: EditorTask[] = []
  for (const task of project.tasks) {
    const layers: LayerModel[] = []
    for (const layer of task.layers) {
      layers.push(await restoreLayerFromProject(layer))
    }
    const fallbackLayerId = layers[layers.length - 1]?.id ?? ''
    tasks.push({
      id: task.id,
      name: task.name,
      canvasWidth: task.canvasWidth,
      canvasHeight: task.canvasHeight,
      layers,
      currentLayerId: layers.some((layer) => layer.id === task.currentLayerId) ? task.currentLayerId : fallbackLayerId,
      zoom: 1,
      panX: 0,
      panY: 0,
      pendingCrop: null,
      cropMode: 'rect',
      pendingPolygon: null,
      hoverPoint: null,
      renderVersion: 0,
      lastExportPath: task.lastExportPath,
      history: [],
      future: [],
    })
  }

  const fallbackTaskId = tasks[0]?.id ?? ''

  return {
    tasks,
    activeTaskId: tasks.some((task) => task.id === project.activeTaskId) ? project.activeTaskId : fallbackTaskId,
  }
}
