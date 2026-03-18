import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorCanvas } from './editor/components/EditorCanvas'
import { useEditorStore } from './editor/store/editorStore'
import type { ToolType } from './editor/types'

const toolLabels: Record<ToolType, string> = {
  move: '移动',
  brush: '画笔',
  eyedropper: '取色',
  fill: '填充',
  crop: '裁剪',
}

const getBaseName = (filePath: string) => filePath.split(/[/\\]/).pop() ?? filePath

const canvasToBytes = async (canvas: HTMLCanvasElement) => {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) {
    throw new Error('PNG export failed')
  }
  return new Uint8Array(await blob.arrayBuffer())
}

const loadImageFile = async (file: File) => {
  const objectUrl = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = objectUrl
    await image.decode()
    return image
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tagName = target.tagName
  return target.isContentEditable || tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT'
}

export default function App() {
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const [draggedLayerId, setDraggedLayerId] = useState<string | null>(null)
  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null)
  const [isFileDragActive, setIsFileDragActive] = useState(false)
  const dragDepthRef = useRef(0)

  const {
    tasks,
    activeTaskId,
    activeTool,
    color,
    brushSize,
    recentColors,
    statusMessage,
    setActiveTask,
    createTask,
    createTaskFromImage,
    setTool,
    setColor,
    setBrushSize,
    zoomIn,
    zoomOut,
    resetView,
    selectLayer,
    addLayer,
    deleteCurrentLayer,
    toggleLayerVisibility,
    reorderLayers,
    setCurrentLayerTransform,
    recordHistory,
    undo,
    redo,
    setStatusMessage,
    setExportPath,
    setPendingCrop,
    applyCrop,
    copyCurrentLayer,
    pasteClipboard,
  } = useEditorStore()

  const currentTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? null,
    [activeTaskId, tasks],
  )
  const orderedLayers = useMemo(() => [...(currentTask?.layers ?? [])].reverse(), [currentTask?.layers])
  const currentLayer = currentTask?.layers.find((layer) => layer.id === currentTask.currentLayerId) ?? null

  const handleLayerDrop = (targetLayerId: string) => {
    if (!draggedLayerId || draggedLayerId === targetLayerId) {
      setDraggedLayerId(null)
      setDragOverLayerId(null)
      return
    }

    const displayOrder = [...orderedLayers]
    const draggedIndex = displayOrder.findIndex((layer) => layer.id === draggedLayerId)
    const targetIndex = displayOrder.findIndex((layer) => layer.id === targetLayerId)
    if (draggedIndex === -1 || targetIndex === -1) {
      setDraggedLayerId(null)
      setDragOverLayerId(null)
      return
    }

    const nextDisplayOrder = [...displayOrder]
    const [draggedLayer] = nextDisplayOrder.splice(draggedIndex, 1)
    nextDisplayOrder.splice(targetIndex, 0, draggedLayer)

    recordHistory()
    reorderLayers(nextDisplayOrder.reverse().map((layer) => layer.id))
    setDraggedLayerId(null)
    setDragOverLayerId(null)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey
      const typing = isTypingTarget(event.target)

      if (command && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSave()
      }

      if (command && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        undo()
      }

      if ((command && event.shiftKey && event.key.toLowerCase() === 'z') || (command && event.key.toLowerCase() === 'y')) {
        event.preventDefault()
        redo()
      }

      if (!typing && command && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        copyCurrentLayer()
      }

      if (!typing && command && event.key.toLowerCase() === 'v') {
        event.preventDefault()
        recordHistory()
        pasteClipboard()
      }

      if (!typing && event.key === '[') {
        event.preventDefault()
        setBrushSize(brushSize - 2)
      }

      if (!typing && event.key === ']') {
        event.preventDefault()
        setBrushSize(brushSize + 2)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [brushSize, copyCurrentLayer, pasteClipboard, recordHistory, redo, setBrushSize, undo])

  useEffect(() => {
    if (!statusMessage || statusMessage === 'Ready') {
      return
    }
    const timer = window.setTimeout(() => useEditorStore.getState().clearStatusMessage(), 3500)
    return () => window.clearTimeout(timer)
  }, [statusMessage])

  const saveToPath = async (filePath: string) => {
    const canvas = compositeCanvasRef.current
    if (!canvas || !currentTask) {
      throw new Error('Canvas not ready')
    }

    const bytes = await canvasToBytes(canvas)
    if (window.electronApi) {
      await window.electronApi.savePng(filePath, bytes)
    } else {
      const blob = new Blob([bytes], { type: 'image/png' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = getBaseName(filePath)
      a.click()
      URL.revokeObjectURL(url)
    }

    setExportPath(filePath)
    setStatusMessage(`已保存到 ${getBaseName(filePath)}`)
  }

  const requestExportPath = async () => {
    if (window.electronApi) {
      return window.electronApi.chooseExportPath()
    }
    return `ps-lite-export.png`
  }

  const handleExport = async () => {
    try {
      const path = await requestExportPath()
      if (!path) {
        setStatusMessage('已取消导出')
        return
      }
      await saveToPath(path)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '导出失败')
    }
  }

  const handleSave = async () => {
    try {
      const targetPath = currentTask?.lastExportPath ?? (await requestExportPath())
      if (!targetPath) {
        setStatusMessage('未选择导出路径')
        return
      }
      await saveToPath(targetPath)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '保存失败')
    }
  }

  const importDroppedFiles = async (files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
    if (imageFiles.length === 0) {
      setStatusMessage('请拖入图片文件')
      return
    }

    for (const file of imageFiles) {
      const image = await loadImageFile(file)
      createTaskFromImage(file.name.replace(/\.[^.]+$/, ''), image, image.naturalWidth, image.naturalHeight)
    }

    setStatusMessage(`已新建 ${imageFiles.length} 个任务`)
  }

  const handleDragEnter = (event: React.DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) {
      return
    }
    event.preventDefault()
    dragDepthRef.current += 1
    setIsFileDragActive(true)
  }

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) {
      return
    }
    event.preventDefault()
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsFileDragActive(false)
    }
  }

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) {
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setIsFileDragActive(true)
  }

  const handleDrop = async (event: React.DragEvent<HTMLElement>) => {
    if (!Array.from(event.dataTransfer.items).some((item) => item.kind === 'file')) {
      return
    }
    event.preventDefault()
    dragDepthRef.current = 0
    setIsFileDragActive(false)
    try {
      await importDroppedFiles(event.dataTransfer.files)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '图片导入失败')
    }
  }

  return (
    <div
      className="app-shell"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <header className="topbar">
        <div className="brand">
          <strong>PS Lite</strong>
          <span>桌面版最小可用图像编辑器</span>
        </div>
        <div className="action-row">
          <button onClick={() => void handleExport()}>导出 PNG</button>
          <button onClick={() => void handleSave()}>保存 Ctrl+S</button>
          <button onClick={undo}>撤销</button>
          <button onClick={redo}>重做</button>
        </div>
      </header>

      <div className="taskbar">
        <div className="task-list">
          {tasks.map((task) => (
            <button
              className={`task-item ${task.id === activeTaskId ? 'is-active' : ''}`}
              key={task.id}
              onClick={() => setActiveTask(task.id)}
            >
              <strong>{task.name}</strong>
              <span>{task.canvasWidth} x {task.canvasHeight}</span>
            </button>
          ))}
        </div>
        <button className="task-add" onClick={() => createTask()}>
          + 新建任务
        </button>
      </div>

      <main className="workspace">
        <aside className="sidebar">
          <section className="panel">
            <h2>工具</h2>
            <div className="tool-grid">
              {Object.entries(toolLabels).map(([tool, label]) => (
                <button
                  className={activeTool === tool ? 'is-active' : ''}
                  key={tool}
                  onClick={() => setTool(tool as ToolType)}
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>颜色与画笔</h2>
            <label className="field">
              <span>前景色</span>
              <input onChange={(event) => setColor(event.target.value)} type="color" value={color} />
            </label>
            <label className="field">
              <span>画笔大小 {brushSize}px</span>
              <input
                max={128}
                min={1}
                onChange={(event) => setBrushSize(Number(event.target.value))}
                type="range"
                value={brushSize}
              />
            </label>
            <div className="recent-colors">
              {recentColors.map((recent) => (
                <button
                  aria-label={`Set color ${recent}`}
                  key={recent}
                  onClick={() => setColor(recent, false)}
                  style={{ backgroundColor: recent }}
                  title={recent}
                />
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>视图</h2>
            <div className="action-row">
              <button onClick={zoomOut}>-</button>
              <button onClick={resetView}>{Math.round((currentTask?.zoom ?? 1) * 100)}%</button>
              <button onClick={zoomIn}>+</button>
            </div>
            <p className="hint">按住 Ctrl + 滚轮缩放，空格或中键拖动画布。</p>
          </section>

          <section className="panel">
            <h2>裁剪</h2>
            <div className="action-row">
              <button
                disabled={!currentTask?.pendingCrop}
                onClick={() => {
                  if (!currentTask?.pendingCrop) return
                  recordHistory()
                  applyCrop()
                }}
              >
                应用裁剪
              </button>
              <button disabled={!currentTask?.pendingCrop} onClick={() => setPendingCrop(null)}>
                取消
              </button>
            </div>
            <p className="hint">切到裁剪工具后拖出区域，再点击应用或按 Enter。</p>
          </section>
        </aside>

        <section className="editor-pane">
          <div className="statusbar">
            <span>{statusMessage}</span>
            <span>{currentTask?.lastExportPath ? `输出: ${getBaseName(currentTask.lastExportPath)}` : '尚未导出'}</span>
          </div>
          <EditorCanvas compositeCanvasRef={compositeCanvasRef} />
        </section>

        <aside className="sidebar right-sidebar">
          <section className="panel">
            <h2>当前任务</h2>
            <p className="hint">{currentTask ? currentTask.name : '未打开任务'}</p>
            <p className="hint">
              画布: {currentTask ? `${currentTask.canvasWidth} x ${currentTask.canvasHeight}` : '-'}
            </p>
            <p className="hint">快捷键: `Ctrl+C` 复制图层，切到其他任务后 `Ctrl+V` 粘贴。</p>
          </section>

          <section className="panel">
            <h2>当前图层</h2>
            <p className="hint">{currentLayer ? currentLayer.name : '未选中图层'}</p>
            <p className="hint">当前工具: {toolLabels[activeTool]}</p>
            <p className="hint">快捷键: `[` `]` 调整画笔，`Ctrl+S` 保存。</p>
            {currentLayer ? (
              <div className="transform-panel">
                <div className="transform-grid">
                  <button
                    onClick={() => {
                      recordHistory()
                      setCurrentLayerTransform({ offsetY: currentLayer.offsetY - 10 })
                    }}
                  >
                    上
                  </button>
                  <button
                    onClick={() => {
                      recordHistory()
                      setCurrentLayerTransform({ offsetY: currentLayer.offsetY + 10 })
                    }}
                  >
                    下
                  </button>
                  <button
                    onClick={() => {
                      recordHistory()
                      setCurrentLayerTransform({ offsetX: currentLayer.offsetX - 10 })
                    }}
                  >
                    左
                  </button>
                  <button
                    onClick={() => {
                      recordHistory()
                      setCurrentLayerTransform({ offsetX: currentLayer.offsetX + 10 })
                    }}
                  >
                    右
                  </button>
                </div>
                <label className="field compact">
                  <span>横向位置</span>
                  <input
                    onChange={(event) => setCurrentLayerTransform({ offsetX: Number(event.target.value) })}
                    type="number"
                    value={Math.round(currentLayer.offsetX)}
                  />
                </label>
                <label className="field compact">
                  <span>纵向位置</span>
                  <input
                    onChange={(event) => setCurrentLayerTransform({ offsetY: Number(event.target.value) })}
                    type="number"
                    value={Math.round(currentLayer.offsetY)}
                  />
                </label>
                <label className="field compact">
                  <span>缩放 {currentLayer.scale.toFixed(2)}x</span>
                  <input
                    max={4}
                    min={0.1}
                    onChange={(event) => setCurrentLayerTransform({ scale: Number(event.target.value) })}
                    step={0.05}
                    type="range"
                    value={currentLayer.scale}
                  />
                </label>
                <button
                  onClick={() => {
                    recordHistory()
                    setCurrentLayerTransform({ offsetX: 0, offsetY: 0, scale: 1 })
                  }}
                >
                  重置变换
                </button>
              </div>
            ) : null}
          </section>

          <section className="panel layer-panel">
            <div className="layer-panel-header">
              <h2>图层</h2>
              <div className="action-row">
                <button
                  onClick={() => {
                    recordHistory()
                    addLayer()
                  }}
                >
                  新建
                </button>
                <button
                  disabled={!currentLayer}
                  onClick={() => {
                    recordHistory()
                    deleteCurrentLayer()
                  }}
                >
                  删除
                </button>
              </div>
            </div>

            <div className="action-row">
              <span className="hint">拖拽图层项调整上下顺序</span>
            </div>

            <div className="layer-list">
              {orderedLayers.map((layer) => (
                <div
                  className={`layer-item ${layer.id === currentTask?.currentLayerId ? 'selected' : ''} ${
                    dragOverLayerId === layer.id ? 'drag-over' : ''
                  }`}
                  draggable
                  key={layer.id}
                  onClick={() => selectLayer(layer.id)}
                  onDragEnd={() => {
                    setDraggedLayerId(null)
                    setDragOverLayerId(null)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    if (draggedLayerId !== layer.id) {
                      setDragOverLayerId(layer.id)
                    }
                  }}
                  onDragStart={() => {
                    setDraggedLayerId(layer.id)
                    setDragOverLayerId(layer.id)
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    handleLayerDrop(layer.id)
                  }}
                >
                  <div className="layer-main">
                    <button
                      aria-label={layer.visible ? `隐藏 ${layer.name}` : `显示 ${layer.name}`}
                      className={`visibility ${layer.visible ? 'is-visible' : 'is-hidden'}`}
                      onClick={(event) => {
                        event.stopPropagation()
                        recordHistory()
                        toggleLayerVisibility(layer.id)
                      }}
                      title={layer.visible ? '隐藏图层' : '显示图层'}
                    >
                      {layer.visible ? '◉' : '○'}
                    </button>
                    <div>
                      <strong>{layer.name}</strong>
                      <span>{layer.width} x {layer.height}</span>
                    </div>
                  </div>
                  <div className="layer-meta">
                    <span className="hint">{layer.id === currentTask?.currentLayerId ? '当前选中' : '点击选中'}</span>
                    <span className="drag-handle" aria-hidden="true">::</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </main>
      {isFileDragActive ? (
        <div className="drop-overlay">
          <div className="drop-card">
            <strong>拖到这里导入图片</strong>
            <span>松开后会在上方自动新建任务 item，画布大小与图片一致</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
