import type {
  EditorTask,
  LayerModel,
  ProjectFileData,
  ProjectLayerData,
  ProjectTaskData,
} from '../types'
import { createLayer } from './canvas'

const loadImage = async (src: string) => {
  const image = new Image()
  image.decoding = 'async'
  image.src = src
  await image.decode()
  return image
}

const layerToProjectData = (layer: LayerModel): ProjectLayerData => ({
  id: layer.id,
  name: layer.name,
  visible: layer.visible,
  opacity: layer.opacity,
  width: layer.width,
  height: layer.height,
  offsetX: layer.offsetX,
  offsetY: layer.offsetY,
  scale: layer.scale,
  rotation: layer.rotation,
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
  const layer = createLayer(data.width, data.height, data.name, data.id)
  layer.visible = data.visible
  layer.opacity = data.opacity
  layer.offsetX = data.offsetX
  layer.offsetY = data.offsetY
  layer.scale = data.scale
  layer.rotation = data.rotation

  const image = await loadImage(data.image)
  const ctx = layer.canvas.getContext('2d')
  ctx?.drawImage(image, 0, 0, data.width, data.height)
  return layer
}

export const deserializeProject = async (project: ProjectFileData): Promise<{ tasks: EditorTask[]; activeTaskId: string }> => {
  const tasks = await Promise.all(
    project.tasks.map(async (task) => {
      const layers = await Promise.all(task.layers.map(restoreLayerFromProject))
      return {
        id: task.id,
        name: task.name,
        canvasWidth: task.canvasWidth,
        canvasHeight: task.canvasHeight,
        layers,
        currentLayerId: task.currentLayerId,
        zoom: 1,
        panX: 0,
        panY: 0,
        pendingCrop: null,
        hoverPoint: null,
        renderVersion: 0,
        lastExportPath: task.lastExportPath,
        history: [],
        future: [],
      } satisfies EditorTask
    }),
  )

  return {
    tasks,
    activeTaskId: project.activeTaskId,
  }
}
