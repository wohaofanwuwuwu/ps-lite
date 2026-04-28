import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorCanvas } from './editor/components/EditorCanvas'
import { useEditorStore } from './editor/store/editorStore'
import type { ToolType } from './editor/types'
import { deserializeProject, serializeProject } from './editor/utils/project'

const toolLabels: Record<ToolType, string> = {
  move: '移动',
  brush: '画笔',
  eraser: '橡皮',
  eyedropper: '取色',
  fill: '填充',
  crop: '裁剪',
  text: '文字',
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
  const inputHistorySessionRef = useRef<string | null>(null)
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
    textSize,
    recentColors,
    statusMessage,
    currentProjectPath,
    setActiveTask,
    deleteTask,
    createTask,
    createTaskFromImage,
    setTool,
    setColor,
    setBrushSize,
    setTextSize,
    zoomIn,
    zoomOut,
    resetView,
    selectLayer,
    addLayer,
    deleteCurrentLayer,
    toggleLayerVisibility,
    reorderLayers,
    mergeCurrentLayerDown,
    setCurrentLayerTransform,
    updateTextLayer,
    recordHistory,
    undo,
    redo,
    setStatusMessage,
    setExportPath,
    setPendingCrop,
    setCropMode,
    clearPolygon,
    applyCrop,
    copyCurrentLayer,
    pasteClipboard,
    loadProjectState,
    setProjectPath,
  } = useEditorStore()

  const currentTask = useMemo(
    () => tasks.find((task) => task.id === activeTaskId) ?? null,
    [activeTaskId, tasks],
  )
  const orderedLayers = useMemo(() => [...(currentTask?.layers ?? [])].reverse(), [currentTask?.layers])
  const currentLayer = currentTask?.layers.find((layer) => layer.id === currentTask.currentLayerId) ?? null
  const currentTextLayer = currentLayer?.type === 'text' ? currentLayer : null
  const canMergeCurrentLayerDown = useMemo(() => {
    if (!currentTask || !currentLayer) {
      return false
    }
    return currentTask.layers.findIndex((layer) => layer.id === currentLayer.id) > 0
  }, [currentLayer, currentTask])

  const beginInputHistorySession = (sessionId: string) => {
    if (inputHistorySessionRef.current === sessionId) {
      return
    }
    recordHistory()
    inputHistorySessionRef.current = sessionId
  }

  const endInputHistorySession = (sessionId: string) => {
    if (inputHistorySessionRef.current === sessionId) {
      inputHistorySessionRef.current = null
    }
  }

  useEffect(() => {
    inputHistorySessionRef.current = null
  }, [activeTaskId, currentTask?.currentLayerId])

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

  const handleColorChange = (value: string) => {
    setColor(value)
    if (activeTool === 'text' && currentTextLayer?.textData) {
      recordHistory()
      updateTextLayer(currentTextLayer.id, { color: value })
    }
  }

  const handleTextColorChange = (value: string) => {
    setColor(value)
    if (currentTextLayer?.textData) {
      recordHistory()
      updateTextLayer(currentTextLayer.id, { color: value })
    }
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
        inputHistorySessionRef.current = null
        undo()
      }

      if ((command && event.shiftKey && event.key.toLowerCase() === 'z') || (command && event.key.toLowerCase() === 'y')) {
        event.preventDefault()
        inputHistorySessionRef.current = null
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

  const handleSaveProject = async () => {
    try {
      if (!window.electronApi) {
        setStatusMessage('当前环境不支持工程文件读写')
        return
      }
      const targetPath = currentProjectPath ?? (await window.electronApi.chooseProjectSavePath())
      if (!targetPath) {
        setStatusMessage('未选择工程保存路径')
        return
      }
      const project = serializeProject(tasks, activeTaskId)
      await window.electronApi.saveProject(targetPath, JSON.stringify(project))
      setProjectPath(targetPath)
      setStatusMessage(`已保存工程 ${getBaseName(targetPath)}`)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '保存工程失败')
    }
  }

  const handleOpenProject = async () => {
    try {
      if (!window.electronApi) {
        setStatusMessage('当前环境不支持工程文件读写')
        return
      }
      const result = await window.electronApi.openProject()
      if (!result) {
        setStatusMessage('已取消打开工程')
        return
      }
      const parsed = JSON.parse(result.content)
      const restored = await deserializeProject(parsed)
      loadProjectState(restored.tasks, restored.activeTaskId, result.filePath)
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : '打开工程失败')
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
          <div className="brand-actions">
            <button onClick={() => void handleOpenProject()}>打开工程</button>
            <button onClick={() => void handleSaveProject()}>保存工程</button>
          </div>
        </div>
        <div className="action-row">
          <button onClick={() => void handleExport()}>导出 PNG</button>
          <button onClick={() => void handleSave()}>保存 Ctrl+S</button>
          <button
            onClick={() => {
              inputHistorySessionRef.current = null
              undo()
            }}
          >
            撤销
          </button>
          <button
            onClick={() => {
              inputHistorySessionRef.current = null
              redo()
            }}
          >
            重做
          </button>
        </div>
      </header>

      <div className="taskbar">
        <div className="task-list">
          {tasks.map((task) => (
            <div
              className={`task-item ${task.id === activeTaskId ? 'is-active' : ''}`}
              key={task.id}
            >
              <button className="task-item-main" onClick={() => setActiveTask(task.id)}>
                <strong>{task.name}</strong>
                <span>{task.canvasWidth} x {task.canvasHeight}</span>
              </button>
              <button
                className="task-delete"
                disabled={tasks.length === 1}
                onClick={() => {
                  if (tasks.length === 1) {
                    return
                  }
                  if (!window.confirm(`删除任务“${task.name}”？`)) {
                    return
                  }
                  deleteTask(task.id)
                }}
                title={tasks.length === 1 ? '至少保留一个任务' : `删除 ${task.name}`}
              >
                ×
              </button>
            </div>
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
              <input onChange={(event) => handleColorChange(event.target.value)} type="color" value={color} />
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
                  onClick={() => handleColorChange(recent)}
                  style={{ backgroundColor: recent }}
                  title={recent}
                />
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>文字</h2>
            <label className="field">
              <span>字体颜色</span>
              <input
                onChange={(event) => handleTextColorChange(event.target.value)}
                type="color"
                value={currentTextLayer?.textData?.color ?? color}
              />
            </label>
            <label className="field">
              <span>默认字号 {currentTextLayer?.textData ? currentTextLayer.textData.fontSize : textSize}px</span>
              <input
                max={256}
                min={8}
                onPointerDown={() => {
                  if (currentTextLayer?.textData) {
                    recordHistory()
                  }
                }}
                onChange={(event) => {
                  const nextSize = Number(event.target.value)
                  setTextSize(nextSize)
                  if (currentTextLayer?.textData) {
                    updateTextLayer(currentTextLayer.id, { fontSize: nextSize })
                  }
                }}
                step={1}
                type="range"
                value={currentTextLayer?.textData ? currentTextLayer.textData.fontSize : textSize}
              />
            </label>
            <div className="recent-colors">
              {recentColors.map((recent) => (
                <button
                  aria-label={`Set text color ${recent}`}
                  key={`text-${recent}`}
                  onClick={() => handleTextColorChange(recent)}
                  style={{ backgroundColor: recent }}
                  title={recent}
                />
              ))}
            </div>
            <p className="hint">切到文字工具后点击画布可新建文字图层，输入框顶部可直接拖动位置。</p>
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
            <label className="field">
              <span>裁剪模式</span>
              <select
                value={currentTask?.cropMode ?? 'rect'}
                onChange={(event) => setCropMode(event.target.value as 'rect' | 'polygon')}
              >
                <option value="rect">四边形裁剪</option>
                <option value="polygon">多边形裁剪</option>
              </select>
            </label>
            {(() => {
              const cropMode = currentTask?.cropMode ?? 'rect'
              const canApply =
                cropMode === 'rect'
                  ? Boolean(currentTask?.pendingCrop)
                  : Boolean(currentTask?.pendingPolygon?.closed)
              const canCancel =
                cropMode === 'rect'
                  ? Boolean(currentTask?.pendingCrop)
                  : Boolean(currentTask?.pendingPolygon)
              const onCancel = () => {
                if (cropMode === 'polygon') {
                  clearPolygon()
                } else {
                  setPendingCrop(null)
                }
              }
              return (
                <>
                  <div className="action-row">
                    <button
                      disabled={!canApply}
                      onClick={() => {
                        if (!canApply) return
                        recordHistory()
                        applyCrop()
                      }}
                    >
                      应用裁剪
                    </button>
                    <button disabled={!canCancel} onClick={onCancel}>
                      取消
                    </button>
                  </div>
                  {cropMode === 'rect' ? (
                    <p className="hint">切到裁剪工具后拖出区域，再点击应用或按 Enter。</p>
                  ) : (
                    <p className="hint">
                      切到裁剪工具后依次点击生成多边形顶点，再次点击起点即可闭合，然后按 Enter 或"应用裁剪"。
                      {currentTask?.pendingPolygon
                        ? `已放置 ${currentTask.pendingPolygon.points.length} 个点${
                            currentTask.pendingPolygon.closed ? ' (已闭合)' : ''
                          }`
                        : null}
                    </p>
                  )}
                </>
              )
            })()}
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
            <p className="hint">图层类型: {currentLayer?.type === 'text' ? '文字图层' : '普通图层'}</p>
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
                  <button
                    onClick={() => {
                      recordHistory()
                      setCurrentLayerTransform({ rotation: currentLayer.rotation - 15 })
                    }}
                  >
                    左旋
                  </button>
                  <button
                    onClick={() => {
                      recordHistory()
                      setCurrentLayerTransform({ rotation: currentLayer.rotation + 15 })
                    }}
                  >
                    右旋
                  </button>
                </div>
                <label className="field compact">
                  <span>横向位置</span>
                  <input
                    onBlur={() => endInputHistorySession('transform-offsetX')}
                    onFocus={() => beginInputHistorySession('transform-offsetX')}
                    onChange={(event) => setCurrentLayerTransform({ offsetX: Number(event.target.value) })}
                    type="number"
                    value={Math.round(currentLayer.offsetX)}
                  />
                </label>
                <label className="field compact">
                  <span>纵向位置</span>
                  <input
                    onBlur={() => endInputHistorySession('transform-offsetY')}
                    onFocus={() => beginInputHistorySession('transform-offsetY')}
                    onChange={(event) => setCurrentLayerTransform({ offsetY: Number(event.target.value) })}
                    type="number"
                    value={Math.round(currentLayer.offsetY)}
                  />
                </label>
                <label className="field compact">
                  <span>横向缩放 {currentLayer.scaleX.toFixed(2)}x</span>
                  <input
                    max={8}
                    min={0.1}
                    onBlur={() => endInputHistorySession('transform-scaleX')}
                    onFocus={() => beginInputHistorySession('transform-scaleX')}
                    onPointerDown={() => beginInputHistorySession('transform-scaleX')}
                    onPointerUp={() => endInputHistorySession('transform-scaleX')}
                    onChange={(event) => setCurrentLayerTransform({ scaleX: Number(event.target.value) })}
                    step={0.05}
                    type="range"
                    value={currentLayer.scaleX}
                  />
                </label>
                <label className="field compact">
                  <span>纵向缩放 {currentLayer.scaleY.toFixed(2)}x</span>
                  <input
                    max={8}
                    min={0.1}
                    onBlur={() => endInputHistorySession('transform-scaleY')}
                    onFocus={() => beginInputHistorySession('transform-scaleY')}
                    onPointerDown={() => beginInputHistorySession('transform-scaleY')}
                    onPointerUp={() => endInputHistorySession('transform-scaleY')}
                    onChange={(event) => setCurrentLayerTransform({ scaleY: Number(event.target.value) })}
                    step={0.05}
                    type="range"
                    value={currentLayer.scaleY}
                  />
                </label>
                <label className="field compact">
                  <span>旋转 {Math.round(currentLayer.rotation)}°</span>
                  <input
                    max={360}
                    min={0}
                    onBlur={() => endInputHistorySession('transform-rotation')}
                    onFocus={() => beginInputHistorySession('transform-rotation')}
                    onPointerDown={() => beginInputHistorySession('transform-rotation')}
                    onPointerUp={() => endInputHistorySession('transform-rotation')}
                    onChange={(event) => setCurrentLayerTransform({ rotation: Number(event.target.value) })}
                    step={1}
                    type="range"
                    value={currentLayer.rotation}
                  />
                </label>
                <button
                  onClick={() => {
                    recordHistory()
                    setCurrentLayerTransform({ offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1, rotation: 0 })
                  }}
                >
                  重置变换
                </button>
                {currentTextLayer?.textData ? (
                  <label className="field compact">
                    <span>文字字号 {currentTextLayer.textData.fontSize}px</span>
                    <input
                      max={256}
                      min={8}
                      onPointerDown={() => recordHistory()}
                      onChange={(event) => updateTextLayer(currentTextLayer.id, { fontSize: Number(event.target.value) })}
                      step={1}
                      type="range"
                      value={currentTextLayer.textData.fontSize}
                    />
                  </label>
                ) : null}
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
                <button
                  disabled={!canMergeCurrentLayerDown}
                  onClick={() => {
                    recordHistory()
                    mergeCurrentLayerDown()
                  }}
                >
                  融合下层
                </button>
              </div>
            </div>

            <div className="action-row">
              <span className="hint">拖拽图层项调整上下顺序，融合会把当前层烘焙进下层。</span>
            </div>

            <div className="layer-list">
              {orderedLayers.map((layer) => (
                <div
                  className={`layer-item ${layer.id === currentTask?.currentLayerId ? 'selected' : ''} ${
                    dragOverLayerId === layer.id ? 'drag-over' : ''
                  }`}
                  key={layer.id}
                  onClick={() => selectLayer(layer.id)}
                  onDragOver={(event) => {
                    event.preventDefault()
                    if (draggedLayerId !== layer.id) {
                      setDragOverLayerId(layer.id)
                    }
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
                      draggable={false}
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
                      <span>{layer.type === 'text' ? `文字 ${layer.width} x ${layer.height}` : `${layer.width} x ${layer.height}`}</span>
                    </div>
                  </div>
                  <div className="layer-meta">
                    <span className="hint">{layer.id === currentTask?.currentLayerId ? '当前选中' : '点击选中'}</span>
                    <span
                      aria-hidden="true"
                      className="drag-handle"
                      draggable
                      onClick={(event) => event.stopPropagation()}
                      onDragEnd={() => {
                        setDraggedLayerId(null)
                        setDragOverLayerId(null)
                      }}
                      onDragStart={(event) => {
                        event.stopPropagation()
                        setDraggedLayerId(layer.id)
                        setDragOverLayerId(layer.id)
                      }}
                    >
                      ::
                    </span>
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
