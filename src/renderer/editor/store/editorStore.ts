import { create } from 'zustand'
import type {
  ClipboardLayer,
  CropRect,
  EditorTask,
  HistorySnapshot,
  LayerModel,
  Point,
  ToolType,
} from '../types'
import { clamp } from '../utils/color'
import {
  createLayer,
  createTextLayer,
  cropLayerCanvas,
  DEFAULT_TEXT_FONT_FAMILY,
  getLayerMatrix,
  invertMatrix,
  multiplyMatrices,
  renderTextLayer,
  resizeLayerCanvas,
  restoreLayer,
  snapshotLayer,
} from '../utils/canvas'

interface EditorState {
  tasks: EditorTask[]
  activeTaskId: string
  activeTool: ToolType
  color: string
  brushSize: number
  textSize: number
  recentColors: string[]
  statusMessage: string
  clipboard: ClipboardLayer | null
  currentProjectPath: string | null
  setActiveTask: (taskId: string) => void
  createTask: (name?: string, width?: number, height?: number) => void
  createTaskFromImage: (name: string, source: CanvasImageSource, width: number, height: number) => void
  setTool: (tool: ToolType) => void
  setColor: (color: string, addToRecent?: boolean) => void
  setBrushSize: (size: number) => void
  setTextSize: (size: number) => void
  setZoom: (zoom: number) => void
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
  setPan: (x: number, y: number) => void
  setHoverPoint: (point: Point | null) => void
  setPendingCrop: (rect: CropRect | null) => void
  setStatusMessage: (message: string) => void
  clearStatusMessage: () => void
  setExportPath: (path: string | null) => void
  selectLayer: (layerId: string) => void
  addLayer: () => void
  addImageLayer: (name: string, source: CanvasImageSource, width: number, height: number) => void
  addTextLayerAt: (point: Point, color?: string, fontSize?: number) => string | null
  deleteCurrentLayer: () => void
  toggleLayerVisibility: (layerId: string) => void
  reorderLayers: (layerIds: string[]) => void
  mergeCurrentLayerDown: () => void
  mutateCurrentLayer: (mutate: (layer: LayerModel) => void) => void
  updateTextLayer: (layerId: string, updates: { content?: string; fontSize?: number; color?: string }) => void
  setCurrentLayerTransform: (transform: {
    offsetX?: number
    offsetY?: number
    scaleX?: number
    scaleY?: number
    rotation?: number
  }) => void
  recordHistory: () => void
  undo: () => void
  redo: () => void
  applyCrop: () => void
  copyCurrentLayer: () => void
  pasteClipboard: () => void
  loadProjectState: (tasks: EditorTask[], activeTaskId: string, filePath: string | null) => void
  setProjectPath: (filePath: string | null) => void
}

let layerCounter = 1
let taskCounter = 1

const nextLayerId = () => {
  layerCounter += 1
  return `layer-${layerCounter}`
}

const nextTaskId = () => {
  taskCounter += 1
  return `task-${taskCounter}`
}

const syncCountersFromTasks = (tasks: EditorTask[]) => {
  const taskIds = tasks
    .map((task) => Number.parseInt(task.id.replace('task-', ''), 10))
    .filter((value) => Number.isFinite(value))
  const layerIds = tasks
    .flatMap((task) => task.layers)
    .map((layer) => Number.parseInt(layer.id.replace('layer-', ''), 10))
    .filter((value) => Number.isFinite(value))

  taskCounter = Math.max(taskCounter, ...(taskIds.length ? taskIds : [taskCounter]))
  layerCounter = Math.max(layerCounter, ...(layerIds.length ? layerIds : [layerCounter]))
}

const createBlankTask = (name = `任务 ${taskCounter}`, width = 1024, height = 768): EditorTask => {
  const layer = createLayer(width, height, 'Background', `layer-${layerCounter}`)
  return {
    id: `task-${taskCounter}`,
    name,
    canvasWidth: width,
    canvasHeight: height,
    layers: [layer],
    currentLayerId: layer.id,
    zoom: 1,
    panX: 0,
    panY: 0,
    pendingCrop: null,
    hoverPoint: null,
    renderVersion: 0,
    lastExportPath: null,
    history: [],
    future: [],
  }
}

const getTaskSnapshot = (task: EditorTask): HistorySnapshot => ({
  width: task.canvasWidth,
  height: task.canvasHeight,
  currentLayerId: task.currentLayerId,
  layers: task.layers.map(snapshotLayer),
})

const restoreTaskFromSnapshot = (task: EditorTask, snapshot: HistorySnapshot): EditorTask => ({
  ...task,
  canvasWidth: snapshot.width,
  canvasHeight: snapshot.height,
  currentLayerId: snapshot.currentLayerId,
  layers: snapshot.layers.map(restoreLayer),
  pendingCrop: null,
  hoverPoint: null,
  renderVersion: task.renderVersion + 1,
})

const addRecentColor = (recentColors: string[], color: string) => {
  const next = [color, ...recentColors.filter((item) => item !== color)]
  return next.slice(0, 8)
}

const updateActiveTask = (
  state: EditorState,
  updater: (task: EditorTask) => EditorTask,
): Pick<EditorState, 'tasks'> => ({
  tasks: state.tasks.map((task) => (task.id === state.activeTaskId ? updater(task) : task)),
})

const addLayerToTask = (
  task: EditorTask,
  name: string,
  source: CanvasImageSource,
  width: number,
  height: number,
) => {
  const nextWidth = Math.max(task.canvasWidth, width)
  const nextHeight = Math.max(task.canvasHeight, height)
  const resizedLayers = task.layers.map((layer) =>
    layer.type === 'text'
      ? layer
      : {
          ...layer,
          width: nextWidth,
          height: nextHeight,
          canvas: resizeLayerCanvas(layer, nextWidth, nextHeight),
        },
  )
  const id = nextLayerId()
  const layer = createLayer(nextWidth, nextHeight, name, id)
  const ctx = layer.canvas.getContext('2d')
  ctx?.drawImage(source, 0, 0, width, height)
  return {
    ...task,
    canvasWidth: nextWidth,
    canvasHeight: nextHeight,
    layers: [...resizedLayers, layer],
    currentLayerId: id,
    renderVersion: task.renderVersion + 1,
  }
}

const initialTask = createBlankTask('任务 1')

export const useEditorStore = create<EditorState>((set) => ({
  tasks: [initialTask],
  activeTaskId: initialTask.id,
  activeTool: 'brush',
  color: '#111111',
  brushSize: 24,
  textSize: 48,
  recentColors: ['#111111', '#ef4444', '#22c55e', '#3b82f6', '#f59e0b'],
  statusMessage: 'Ready',
  clipboard: null,
  currentProjectPath: null,
  setActiveTask: (taskId) => set({ activeTaskId: taskId }),
  createTask: (name, width = 1024, height = 768) =>
    set((state) => {
      const id = nextTaskId()
      const layerId = nextLayerId()
      const layer = createLayer(width, height, 'Background', layerId)
      const task: EditorTask = {
        id,
        name: name ?? `任务 ${taskCounter}`,
        canvasWidth: width,
        canvasHeight: height,
        layers: [layer],
        currentLayerId: layerId,
        zoom: 1,
        panX: 0,
        panY: 0,
        pendingCrop: null,
        hoverPoint: null,
        renderVersion: 0,
        lastExportPath: null,
        history: [],
        future: [],
      }
      return {
        tasks: [...state.tasks, task],
        activeTaskId: id,
        statusMessage: `已新建 ${task.name}`,
      }
    }),
  createTaskFromImage: (name, source, width, height) =>
    set((state) => {
      const id = nextTaskId()
      const layerId = nextLayerId()
      const layerName = name || `Layer ${layerCounter}`
      const layer = createLayer(width, height, layerName, layerId)
      const ctx = layer.canvas.getContext('2d')
      ctx?.drawImage(source, 0, 0, width, height)
      const task: EditorTask = {
        id,
        name: layerName,
        canvasWidth: width,
        canvasHeight: height,
        layers: [layer],
        currentLayerId: layerId,
        zoom: 1,
        panX: 0,
        panY: 0,
        pendingCrop: null,
        hoverPoint: null,
        renderVersion: 0,
        lastExportPath: null,
        history: [],
        future: [],
      }
      return {
        tasks: [...state.tasks, task],
        activeTaskId: id,
        statusMessage: `已导入任务 ${task.name}`,
      }
    }),
  setTool: (tool) => set({ activeTool: tool }),
  setColor: (color, addToRecent = true) =>
    set((state) => ({
      color,
      recentColors: addToRecent ? addRecentColor(state.recentColors, color) : state.recentColors,
    })),
  setBrushSize: (size) => set({ brushSize: clamp(size, 1, 128) }),
  setTextSize: (size) => set({ textSize: clamp(size, 8, 256) }),
  setZoom: (zoom) =>
    set((state) => updateActiveTask(state, (task) => ({ ...task, zoom: clamp(zoom, 0.25, 4) }))),
  zoomIn: () =>
    set((state) =>
      updateActiveTask(state, (task) => ({ ...task, zoom: clamp(task.zoom + 0.25, 0.25, 4) })),
    ),
  zoomOut: () =>
    set((state) =>
      updateActiveTask(state, (task) => ({ ...task, zoom: clamp(task.zoom - 0.25, 0.25, 4) })),
    ),
  resetView: () =>
    set((state) => updateActiveTask(state, (task) => ({ ...task, zoom: 1, panX: 0, panY: 0 }))),
  setPan: (x, y) => set((state) => updateActiveTask(state, (task) => ({ ...task, panX: x, panY: y }))),
  setHoverPoint: (point) =>
    set((state) => updateActiveTask(state, (task) => ({ ...task, hoverPoint: point }))),
  setPendingCrop: (rect) =>
    set((state) => updateActiveTask(state, (task) => ({ ...task, pendingCrop: rect }))),
  setStatusMessage: (message) => set({ statusMessage: message }),
  clearStatusMessage: () => set({ statusMessage: 'Ready' }),
  setExportPath: (path) =>
    set((state) => updateActiveTask(state, (task) => ({ ...task, lastExportPath: path }))),
  selectLayer: (layerId) =>
    set((state) => updateActiveTask(state, (task) => ({ ...task, currentLayerId: layerId }))),
  addLayer: () =>
    set((state) =>
      updateActiveTask(state, (task) => {
        const id = nextLayerId()
        const layer = createLayer(task.canvasWidth, task.canvasHeight, `Layer ${layerCounter}`, id)
        return {
          ...task,
          layers: [...task.layers, layer],
          currentLayerId: id,
          renderVersion: task.renderVersion + 1,
        }
      }),
    ),
  addImageLayer: (name, source, width, height) =>
    set((state) => updateActiveTask(state, (task) => addLayerToTask(task, name, source, width, height))),
  addTextLayerAt: (point, color, fontSize) => {
    const id = nextLayerId()
    set((state) =>
      updateActiveTask(state, (task) => {
        const layer = createTextLayer(
          `文本 ${layerCounter}`,
          id,
          {
            content: '文字',
            fontSize: clamp(fontSize ?? state.textSize, 8, 256),
            color: color ?? state.color,
            fontFamily: DEFAULT_TEXT_FONT_FAMILY,
          },
          Math.round(point.x),
          Math.round(point.y),
        )
        return {
          ...task,
          layers: [...task.layers, layer],
          currentLayerId: id,
          renderVersion: task.renderVersion + 1,
        }
      }),
    )
    return id
  },
  deleteCurrentLayer: () =>
    set((state) =>
      updateActiveTask(state, (task) => {
        if (task.layers.length === 1) {
          return task
        }
        const nextLayers = task.layers.filter((layer) => layer.id !== task.currentLayerId)
        return {
          ...task,
          layers: nextLayers,
          currentLayerId: nextLayers[nextLayers.length - 1]!.id,
          renderVersion: task.renderVersion + 1,
        }
      }),
    ),
  toggleLayerVisibility: (layerId) =>
    set((state) =>
      updateActiveTask(state, (task) => ({
        ...task,
        layers: task.layers.map((layer) =>
          layer.id === layerId ? { ...layer, visible: !layer.visible } : layer,
        ),
        renderVersion: task.renderVersion + 1,
      })),
    ),
  reorderLayers: (layerIds) =>
    set((state) =>
      updateActiveTask(state, (task) => {
        if (layerIds.length !== task.layers.length) {
          return task
        }
        const layerMap = new Map(task.layers.map((layer) => [layer.id, layer] as const))
        const nextLayers = layerIds
          .map((id) => layerMap.get(id))
          .filter((layer): layer is LayerModel => Boolean(layer))
        if (nextLayers.length !== task.layers.length) {
          return task
        }
        return {
          ...task,
          layers: nextLayers,
          renderVersion: task.renderVersion + 1,
        }
      }),
    ),
  mergeCurrentLayerDown: () =>
    set((state) =>
      updateActiveTask(state, (task) => {
        const sourceIndex = task.layers.findIndex((layer) => layer.id === task.currentLayerId)
        if (sourceIndex <= 0) {
          return task
        }

        const sourceLayer = task.layers[sourceIndex]
        const targetLayer = {
          ...task.layers[sourceIndex - 1],
          type: 'bitmap' as const,
          textData: null,
        }
        const targetContext = targetLayer.canvas.getContext('2d')
        if (!targetContext) {
          return task
        }

        targetContext.save()
        const relativeMatrix = multiplyMatrices(
          invertMatrix(getLayerMatrix(targetLayer)),
          getLayerMatrix(sourceLayer),
        )
        targetContext.transform(
          relativeMatrix.a,
          relativeMatrix.b,
          relativeMatrix.c,
          relativeMatrix.d,
          relativeMatrix.e,
          relativeMatrix.f,
        )
        targetContext.globalAlpha = sourceLayer.opacity
        targetContext.drawImage(sourceLayer.canvas, 0, 0)
        targetContext.restore()

        const nextLayers = task.layers
          .map((layer) => (layer.id === targetLayer.id ? targetLayer : layer))
          .filter((layer) => layer.id !== sourceLayer.id)
        return {
          ...task,
          layers: nextLayers,
          currentLayerId: targetLayer.id,
          renderVersion: task.renderVersion + 1,
        }
      }),
    ),
  mutateCurrentLayer: (mutate) =>
    set((state) =>
      updateActiveTask(state, (task) => ({
        ...task,
        layers: task.layers.map((layer) => {
          if (layer.id !== task.currentLayerId) {
            return layer
          }
          const nextLayer =
            layer.type === 'text'
              ? {
                  ...layer,
                  type: 'bitmap' as const,
                  textData: null,
                }
              : { ...layer }
          mutate(nextLayer)
          return nextLayer
        }),
        renderVersion: task.renderVersion + 1,
      })),
    ),
  updateTextLayer: (layerId, updates) =>
    set((state) =>
      updateActiveTask(state, (task) => ({
        ...task,
        layers: task.layers.map((layer) => {
          if (layer.id !== layerId || layer.type !== 'text' || !layer.textData) {
            return layer
          }
          const nextLayer = {
            ...layer,
            textData: {
              ...layer.textData,
              ...updates,
              fontSize: clamp(updates.fontSize ?? layer.textData.fontSize, 8, 256),
            },
          }
          return renderTextLayer(nextLayer)
        }),
        renderVersion: task.renderVersion + 1,
      })),
    ),
  setCurrentLayerTransform: (transform) =>
    set((state) =>
      updateActiveTask(state, (task) => ({
        ...task,
        layers: task.layers.map((layer) => {
          if (layer.id !== task.currentLayerId) {
            return layer
          }
          return {
            ...layer,
            offsetX: transform.offsetX ?? layer.offsetX,
            offsetY: transform.offsetY ?? layer.offsetY,
            scaleX: clamp(transform.scaleX ?? layer.scaleX, 0.1, 8),
            scaleY: clamp(transform.scaleY ?? layer.scaleY, 0.1, 8),
            rotation: ((transform.rotation ?? layer.rotation) % 360 + 360) % 360,
          }
        }),
        renderVersion: task.renderVersion + 1,
      })),
    ),
  recordHistory: () =>
    set((state) =>
      updateActiveTask(state, (task) => ({
        ...task,
        history: [...task.history, getTaskSnapshot(task)].slice(-30),
        future: [],
      })),
    ),
  undo: () =>
    set((state) =>
      updateActiveTask(state, (task) => {
        const previous = task.history[task.history.length - 1]
        if (!previous) {
          return task
        }
        const restored = restoreTaskFromSnapshot(task, previous)
        return {
          ...restored,
          history: task.history.slice(0, -1),
          future: [getTaskSnapshot(task), ...task.future].slice(0, 30),
        }
      }),
    ),
  redo: () =>
    set((state) =>
      updateActiveTask(state, (task) => {
        const next = task.future[0]
        if (!next) {
          return task
        }
        const restored = restoreTaskFromSnapshot(task, next)
        return {
          ...restored,
          history: [...task.history, getTaskSnapshot(task)].slice(-30),
          future: task.future.slice(1),
        }
      }),
    ),
  applyCrop: () =>
    set((state) =>
      updateActiveTask(state, (task) => {
        const rect = task.pendingCrop
        if (!rect || rect.width <= 0 || rect.height <= 0) {
          return task
        }
        const nextLayers = task.layers.map((layer) => ({
          ...layer,
          type: 'bitmap' as const,
          textData: null,
          width: rect.width,
          height: rect.height,
          canvas: cropLayerCanvas(layer, rect),
        }))
        return {
          ...task,
          canvasWidth: rect.width,
          canvasHeight: rect.height,
          layers: nextLayers,
          pendingCrop: null,
          renderVersion: task.renderVersion + 1,
        }
      }),
    ),
  copyCurrentLayer: () =>
    set((state) => {
      const task = state.tasks.find((item) => item.id === state.activeTaskId)
      const layer = task?.layers.find((item) => item.id === task.currentLayerId)
      if (!layer) {
        return state
      }
      return {
        clipboard: {
          name: layer.name,
          snapshot: snapshotLayer(layer),
        },
        statusMessage: `已复制图层 ${layer.name}`,
      }
    }),
  pasteClipboard: () =>
    set((state) => {
      if (!state.clipboard) {
        return {
          ...state,
          statusMessage: '没有可粘贴的图层',
        }
      }
      return {
        ...state,
        ...updateActiveTask(state, (task) => {
          const sourceLayer = restoreLayer(state.clipboard!.snapshot)
          return addLayerToTask(
            task,
            `${state.clipboard!.name} Copy`,
            sourceLayer.canvas,
            sourceLayer.width,
            sourceLayer.height,
          )
        }),
        statusMessage: `已粘贴到当前任务`,
      }
    }),
  loadProjectState: (tasks, activeTaskId, filePath) =>
    set(() => {
      syncCountersFromTasks(tasks)
      return {
        tasks,
        activeTaskId,
        currentProjectPath: filePath,
        clipboard: null,
        statusMessage: filePath ? `已打开 ${filePath.split(/[/\\]/).pop()}` : '已加载工程',
      }
    }),
  setProjectPath: (filePath) => set({ currentProjectPath: filePath }),
}))
