import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditorStore } from '../store/editorStore'
import { rgbaToHex } from '../utils/color'
import {
  applyLayerTransform,
  compositeLayers,
  drawLine,
  fillCanvas,
  getLayerMatrix,
  getLayerScaleMagnitude,
  TEXT_LAYER_PADDING_X,
  TEXT_LAYER_PADDING_Y,
  toLayerLocalPoint,
} from '../utils/canvas'
import type { CropRect, LayerModel, Point } from '../types'

interface EditorCanvasProps {
  compositeCanvasRef: React.RefObject<HTMLCanvasElement | null>
}

const normalizeRect = (start: Point, end: Point): CropRect => ({
  x: Math.round(Math.min(start.x, end.x)),
  y: Math.round(Math.min(start.y, end.y)),
  width: Math.round(Math.abs(end.x - start.x)),
  height: Math.round(Math.abs(end.y - start.y)),
})

const isPointInsideLayer = (layer: LayerModel, point: Point) => {
  const localPoint = toLayerLocalPoint(layer, point)
  return localPoint.x >= 0 && localPoint.y >= 0 && localPoint.x <= layer.width && localPoint.y <= layer.height
}

type ResizeHandle = 'scaleX' | 'scaleY' | 'scaleUniform'

const getLayerAxisProjection = (layer: Pick<LayerModel, 'offsetX' | 'offsetY' | 'rotation'>, point: Point) => {
  const radians = (layer.rotation * Math.PI) / 180
  const dx = point.x - layer.offsetX
  const dy = point.y - layer.offsetY
  return {
    x: dx * Math.cos(radians) + dy * Math.sin(radians),
    y: -dx * Math.sin(radians) + dy * Math.cos(radians),
  }
}

const getLayerCornerPoints = (layer: LayerModel) => {
  const matrix = getLayerMatrix(layer)
  const transformPoint = (x: number, y: number): Point => ({
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f,
  })

  return {
    topLeft: transformPoint(0, 0),
    topRight: transformPoint(layer.width, 0),
    bottomLeft: transformPoint(0, layer.height),
    bottomRight: transformPoint(layer.width, layer.height),
    rightCenter: transformPoint(layer.width, layer.height / 2),
    bottomCenter: transformPoint(layer.width / 2, layer.height),
  }
}

export function EditorCanvas({ compositeCanvasRef }: EditorCanvasProps) {
  const {
    tasks,
    activeTaskId,
    activeTool,
    color,
    brushSize,
    textSize,
    mutateCurrentLayer,
    addTextLayerAt,
    setCurrentLayerTransform,
    setColor,
    setHoverPoint,
    setPendingCrop,
    setPan,
    selectLayer,
    setStatusMessage,
    updateTextLayer,
    recordHistory,
    applyCrop,
  } = useEditorStore()
  const currentTask = tasks.find((task) => task.id === activeTaskId) ?? null
  const canvasWidth = currentTask?.canvasWidth ?? 1
  const canvasHeight = currentTask?.canvasHeight ?? 1
  const layers = currentTask?.layers ?? []
  const zoom = currentTask?.zoom ?? 1
  const panX = currentTask?.panX ?? 0
  const panY = currentTask?.panY ?? 0
  const pendingCrop = currentTask?.pendingCrop ?? null
  const hoverPoint = currentTask?.hoverPoint ?? null
  const renderVersion = currentTask?.renderVersion ?? 0
  const currentLayer = currentTask?.layers.find((layer) => layer.id === currentTask.currentLayerId) ?? null
  const [activeTextLayerId, setActiveTextLayerId] = useState<string | null>(null)
  const activeTextLayer =
    currentTask?.layers.find((layer) => layer.id === activeTextLayerId && layer.type === 'text') ?? null

  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const textEditorRef = useRef<HTMLTextAreaElement | null>(null)
  const drawingRef = useRef(false)
  const panningRef = useRef(false)
  const lastPointRef = useRef<Point | null>(null)
  const cropStartRef = useRef<Point | null>(null)
  const moveStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number; layerId: string } | null>(null)
  const resizeStartRef = useRef<{ handle: ResizeHandle; layerId: string } | null>(null)
  const panStartRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null)
  const textMoveStartRef = useRef<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(
    null,
  )
  const textEditHistoryRef = useRef<string | null>(null)
  const selectTextOnFocusRef = useRef(false)
  const spacePressedRef = useRef(false)

  useEffect(() => {
    if (!currentTask) {
      return
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spacePressedRef.current = true
      }
      if (event.key === 'Escape') {
        setPendingCrop(null)
        setActiveTextLayerId(null)
        textEditHistoryRef.current = null
      }
      if (event.key === 'Enter' && activeTool === 'crop' && pendingCrop) {
        recordHistory()
        applyCrop()
      }
    }

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        spacePressedRef.current = false
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [activeTool, applyCrop, currentTask, pendingCrop, recordHistory, setPendingCrop])

  useEffect(() => {
    if (activeTool !== 'text') {
      setActiveTextLayerId(null)
      textEditHistoryRef.current = null
    }
  }, [activeTool])

  useEffect(() => {
    if (!activeTextLayer || currentTask?.currentLayerId !== activeTextLayer.id) {
      setActiveTextLayerId(null)
      textEditHistoryRef.current = null
    }
  }, [activeTextLayer, currentTask?.currentLayerId])

  useEffect(() => {
    if (!activeTextLayer) {
      return
    }
    const editor = textEditorRef.current
    if (!editor) {
      return
    }
    editor.focus()
    if (selectTextOnFocusRef.current) {
      editor.select()
      selectTextOnFocusRef.current = false
    }
  }, [activeTextLayer])

  useEffect(() => {
    if (!currentTask) {
      return
    }
    const composite = compositeCanvasRef.current
    if (!composite) {
      return
    }

    let frame = requestAnimationFrame(() => {
      compositeLayers(composite, layers, canvasWidth, canvasHeight)
    })
    return () => cancelAnimationFrame(frame)
  }, [canvasHeight, canvasWidth, compositeCanvasRef, currentTask, layers, renderVersion])

  useEffect(() => {
    if (!currentTask) {
      return
    }
    const overlay = overlayRef.current
    if (!overlay) {
      return
    }

    overlay.width = canvasWidth
    overlay.height = canvasHeight
    const ctx = overlay.getContext('2d')
    if (!ctx) {
      return
    }

    ctx.clearRect(0, 0, overlay.width, overlay.height)

    if (pendingCrop) {
      ctx.save()
      ctx.fillStyle = 'rgba(15, 23, 42, 0.35)'
      ctx.fillRect(0, 0, canvasWidth, canvasHeight)
      ctx.clearRect(pendingCrop.x, pendingCrop.y, pendingCrop.width, pendingCrop.height)
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 2
      ctx.setLineDash([8, 6])
      ctx.strokeRect(pendingCrop.x, pendingCrop.y, pendingCrop.width, pendingCrop.height)
      ctx.restore()
    }

    if (hoverPoint && (activeTool === 'brush' || activeTool === 'eraser')) {
      ctx.save()
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.arc(hoverPoint.x, hoverPoint.y, brushSize / 2, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()
    }

    if (activeTool === 'move') {
      const lineWidth = Math.max(1 / zoom, 0.75)
      for (const layer of layers) {
        if (!layer.visible) {
          continue
        }
        const isSelected = layer.id === currentLayer?.id
        const corners = getLayerCornerPoints(layer)

        ctx.save()
        ctx.strokeStyle = isSelected ? '#38bdf8' : 'rgba(248, 250, 252, 0.72)'
        ctx.lineWidth = isSelected ? lineWidth * 1.5 : lineWidth
        ctx.setLineDash(isSelected ? [8 / zoom, 6 / zoom] : [4 / zoom, 4 / zoom])
        ctx.beginPath()
        ctx.moveTo(corners.topLeft.x, corners.topLeft.y)
        ctx.lineTo(corners.topRight.x, corners.topRight.y)
        ctx.lineTo(corners.bottomRight.x, corners.bottomRight.y)
        ctx.lineTo(corners.bottomLeft.x, corners.bottomLeft.y)
        ctx.closePath()
        ctx.stroke()
        ctx.restore()

        ctx.save()
        ctx.font = `${Math.max(12 / zoom, 10)}px "Segoe UI", sans-serif`
        ctx.fillStyle = isSelected ? '#e0f2fe' : 'rgba(226, 232, 240, 0.88)'
        const sizeLabel = `${Math.round(layer.width * layer.scaleX)} x ${Math.round(layer.height * layer.scaleY)}`
        ctx.fillText(sizeLabel, corners.topLeft.x + 6 / zoom, corners.topLeft.y - 8 / zoom)
        ctx.restore()

        if (!isSelected) {
          continue
        }

        const handleSize = 6 / zoom
        const handlePoints = [corners.rightCenter, corners.bottomCenter, corners.bottomRight]
        ctx.save()
        ctx.fillStyle = '#0ea5e9'
        ctx.strokeStyle = '#e0f2fe'
        ctx.lineWidth = lineWidth
        handlePoints.forEach((handlePoint) => {
          ctx.beginPath()
          ctx.rect(handlePoint.x - handleSize, handlePoint.y - handleSize, handleSize * 2, handleSize * 2)
          ctx.fill()
          ctx.stroke()
        })
        ctx.restore()
      }
    } else if (currentLayer && activeTool === 'text' && currentLayer.type === 'text') {
      ctx.save()
      ctx.strokeStyle = '#f8fafc'
      ctx.lineWidth = Math.max(1.5 / zoom, 0.75)
      ctx.setLineDash([8 / zoom, 6 / zoom])
      applyLayerTransform(ctx, currentLayer)
      ctx.strokeRect(0, 0, currentLayer.canvas.width, currentLayer.canvas.height)
      ctx.restore()
    }
  }, [activeTool, brushSize, canvasHeight, canvasWidth, currentLayer, currentTask, hoverPoint, layers, pendingCrop, renderVersion, zoom])

  const viewStyle = useMemo(
    () => ({
      width: `${canvasWidth}px`,
      height: `${canvasHeight}px`,
      transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
      transformOrigin: 'top left',
    }),
    [canvasHeight, canvasWidth, panX, panY, zoom],
  )

  const getCanvasPoint = (event: React.PointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) / zoom,
      y: (event.clientY - rect.top) / zoom,
    }
  }

  const getTopTextLayerAtPoint = (point: Point) => {
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const layer = layers[index]
      if (!layer || !layer.visible || layer.type !== 'text') {
        continue
      }
      if (isPointInsideLayer(layer, point)) {
        return layer
      }
    }
    return null
  }

  const getTopLayerAtPoint = (point: Point) => {
    for (let index = layers.length - 1; index >= 0; index -= 1) {
      const layer = layers[index]
      if (!layer || !layer.visible) {
        continue
      }
      if (isPointInsideLayer(layer, point)) {
        return layer
      }
    }
    return null
  }

  const getResizeHandleAtPoint = (layer: LayerModel, point: Point): ResizeHandle | null => {
    const corners = getLayerCornerPoints(layer)
    const hitRadius = 10 / zoom
    const handleEntries: Array<{ handle: ResizeHandle; point: Point }> = [
      { handle: 'scaleX', point: corners.rightCenter },
      { handle: 'scaleY', point: corners.bottomCenter },
      { handle: 'scaleUniform', point: corners.bottomRight },
    ]

    for (const entry of handleEntries) {
      const dx = point.x - entry.point.x
      const dy = point.y - entry.point.y
      if (Math.hypot(dx, dy) <= hitRadius) {
        return entry.handle
      }
    }

    return null
  }

  const beginPan = (event: React.PointerEvent<HTMLCanvasElement>) => {
    panningRef.current = true
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      originX: panX,
      originY: panY,
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    const point = getCanvasPoint(event)
    setHoverPoint(point)

    if (event.button === 1 || spacePressedRef.current) {
      beginPan(event)
      return
    }

    if (activeTool === 'text') {
      const hitLayer = getTopTextLayerAtPoint(point)
      if (hitLayer) {
        selectLayer(hitLayer.id)
        setActiveTextLayerId(hitLayer.id)
        textEditHistoryRef.current = null
        return
      }

      recordHistory()
      const nextLayerId = addTextLayerAt(point, color, textSize)
      if (nextLayerId) {
        selectLayer(nextLayerId)
        setActiveTextLayerId(nextLayerId)
        textEditHistoryRef.current = null
        selectTextOnFocusRef.current = true
        setStatusMessage('输入文字后可直接拖动输入框顶部调整位置')
      }
      return
    }

    if (activeTool === 'brush') {
      if (!currentLayer) {
        return
      }
      drawingRef.current = true
      lastPointRef.current = toLayerLocalPoint(currentLayer, point)
      recordHistory()
      mutateCurrentLayer((layer) =>
        drawLine(
          layer.canvas,
          toLayerLocalPoint(layer, point),
          toLayerLocalPoint(layer, point),
          color,
          brushSize / getLayerScaleMagnitude(layer),
        ),
      )
      return
    }

    if (activeTool === 'eraser') {
      if (!currentLayer) {
        return
      }
      drawingRef.current = true
      lastPointRef.current = toLayerLocalPoint(currentLayer, point)
      recordHistory()
      mutateCurrentLayer((layer) =>
        drawLine(
          layer.canvas,
          toLayerLocalPoint(layer, point),
          toLayerLocalPoint(layer, point),
          '#000000',
          brushSize / getLayerScaleMagnitude(layer),
          'destination-out',
        ),
      )
      return
    }

    if (activeTool === 'move' && currentLayer) {
      const handle = getResizeHandleAtPoint(currentLayer, point)
      if (handle) {
        resizeStartRef.current = {
          handle,
          layerId: currentLayer.id,
        }
        recordHistory()
        return
      }

      const hitLayer = getTopLayerAtPoint(point)
      if (hitLayer) {
        if (hitLayer.id !== currentLayer.id) {
          selectLayer(hitLayer.id)
        }
        moveStartRef.current = {
          x: point.x,
          y: point.y,
          offsetX: hitLayer.offsetX,
          offsetY: hitLayer.offsetY,
          layerId: hitLayer.id,
        }
        recordHistory()
        return
      }

      moveStartRef.current = {
        x: point.x,
        y: point.y,
        offsetX: currentLayer.offsetX,
        offsetY: currentLayer.offsetY,
        layerId: currentLayer.id,
      }
      recordHistory()
      return
    }

    if (activeTool === 'fill') {
      if (!currentLayer) {
        return
      }
      const localPoint = toLayerLocalPoint(currentLayer, point)
      recordHistory()
      mutateCurrentLayer((layer) =>
        fillCanvas(layer.canvas, localPoint, [
          Number.parseInt(color.slice(1, 3), 16),
          Number.parseInt(color.slice(3, 5), 16),
          Number.parseInt(color.slice(5, 7), 16),
          255,
        ]),
      )
      setStatusMessage('Applied fill')
      return
    }

    if (activeTool === 'eyedropper') {
      const composite = compositeCanvasRef.current
      const ctx = composite?.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        return
      }
      const sample = ctx.getImageData(Math.floor(point.x), Math.floor(point.y), 1, 1).data
      const nextColor = rgbaToHex(sample[0]!, sample[1]!, sample[2]!)
      setColor(nextColor)
      setStatusMessage(`Picked ${nextColor}`)
      return
    }

    if (activeTool === 'crop') {
      cropStartRef.current = point
      setPendingCrop({ x: point.x, y: point.y, width: 1, height: 1 })
    }
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const point = getCanvasPoint(event)
    setHoverPoint(point)

    if (panningRef.current && panStartRef.current) {
      setPan(
        panStartRef.current.originX + event.clientX - panStartRef.current.x,
        panStartRef.current.originY + event.clientY - panStartRef.current.y,
      )
      return
    }

    if (activeTool === 'move' && resizeStartRef.current && currentLayer) {
      const projected = getLayerAxisProjection(currentLayer, point)
      if (resizeStartRef.current.handle === 'scaleX') {
        setCurrentLayerTransform({
          scaleX: projected.x / Math.max(currentLayer.width, 1),
        })
      } else if (resizeStartRef.current.handle === 'scaleY') {
        setCurrentLayerTransform({
          scaleY: projected.y / Math.max(currentLayer.height, 1),
        })
      } else {
        const nextUniformScale = Math.max(
          projected.x / Math.max(currentLayer.width, 1),
          projected.y / Math.max(currentLayer.height, 1),
        )
        setCurrentLayerTransform({
          scaleX: nextUniformScale,
          scaleY: nextUniformScale,
        })
      }
      return
    }

    if (activeTool === 'move' && moveStartRef.current) {
      setCurrentLayerTransform({
        offsetX: moveStartRef.current.offsetX + point.x - moveStartRef.current.x,
        offsetY: moveStartRef.current.offsetY + point.y - moveStartRef.current.y,
      })
      return
    }

    if ((activeTool === 'brush' || activeTool === 'eraser') && drawingRef.current && lastPointRef.current) {
      const start = lastPointRef.current
      if (!currentLayer) {
        return
      }
      const localPoint = toLayerLocalPoint(currentLayer, point)
      lastPointRef.current = localPoint
      mutateCurrentLayer((layer) =>
        drawLine(
          layer.canvas,
          start,
          localPoint,
          activeTool === 'eraser' ? '#000000' : color,
          brushSize / getLayerScaleMagnitude(layer),
          activeTool === 'eraser' ? 'destination-out' : 'source-over',
        ),
      )
      return
    }

    if (activeTool === 'crop' && cropStartRef.current) {
      setPendingCrop(normalizeRect(cropStartRef.current, point))
    }
  }

  const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
    drawingRef.current = false
    panningRef.current = false
    lastPointRef.current = null
    moveStartRef.current = null
    resizeStartRef.current = null
    panStartRef.current = null
    cropStartRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    if (!currentTask) {
      return
    }
    if (!event.ctrlKey) {
      return
    }
    event.preventDefault()
    const next = zoom + (event.deltaY < 0 ? 0.1 : -0.1)
    useEditorStore.getState().setZoom(next)
  }

  const handleTextEditorPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
  }

  const handleTextChange = (value: string) => {
    if (!activeTextLayer) {
      return
    }
    if (textEditHistoryRef.current !== activeTextLayer.id) {
      recordHistory()
      textEditHistoryRef.current = activeTextLayer.id
    }
    updateTextLayer(activeTextLayer.id, { content: value })
  }

  const handleTextDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!activeTextLayer) {
      return
    }
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    textMoveStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      offsetX: activeTextLayer.offsetX,
      offsetY: activeTextLayer.offsetY,
    }
    recordHistory()
  }

  const handleTextDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!textMoveStartRef.current || textMoveStartRef.current.pointerId !== event.pointerId) {
      return
    }
    event.stopPropagation()
    setCurrentLayerTransform({
      offsetX: textMoveStartRef.current.offsetX + (event.clientX - textMoveStartRef.current.x) / zoom,
      offsetY: textMoveStartRef.current.offsetY + (event.clientY - textMoveStartRef.current.y) / zoom,
    })
  }

  const handleTextDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!textMoveStartRef.current || textMoveStartRef.current.pointerId !== event.pointerId) {
      return
    }
    event.stopPropagation()
    event.currentTarget.releasePointerCapture(event.pointerId)
    textMoveStartRef.current = null
  }

  if (!currentTask) {
    return <div className="canvas-empty">没有打开的任务</div>
  }

  return (
    <div className="canvas-shell" onWheel={handleWheel} ref={wrapperRef}>
      <div className="canvas-stage" style={viewStyle}>
        <div className="checkerboard" />
        <canvas
          className="editor-canvas"
          height={canvasHeight}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => setHoverPoint(null)}
          ref={compositeCanvasRef}
          width={canvasWidth}
        />
        <canvas
          className="overlay-canvas"
          height={canvasHeight}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => setHoverPoint(null)}
          ref={overlayRef}
          width={canvasWidth}
        />
        {activeTextLayer?.textData ? (
          <div
            className="text-editor"
            onPointerDown={handleTextEditorPointerDown}
            style={{
              left: `${activeTextLayer.offsetX}px`,
              top: `${activeTextLayer.offsetY}px`,
              width: `${Math.max(activeTextLayer.width, 160)}px`,
              transform: `rotate(${activeTextLayer.rotation}deg) scale(${activeTextLayer.scaleX}, ${activeTextLayer.scaleY})`,
              transformOrigin: 'top left',
            }}
          >
            <div
              className="text-editor-handle"
              onPointerDown={handleTextDragStart}
              onPointerMove={handleTextDragMove}
              onPointerUp={handleTextDragEnd}
            >
              文字图层
            </div>
            <textarea
              className="text-editor-input"
              onChange={(event) => handleTextChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.stopPropagation()
                  setActiveTextLayerId(null)
                  textEditHistoryRef.current = null
                }
              }}
              ref={textEditorRef}
              rows={Math.max(activeTextLayer.textData.content.split(/\r?\n/).length, 1)}
              style={{
                color: activeTextLayer.textData.color,
                fontFamily: activeTextLayer.textData.fontFamily,
                fontSize: `${activeTextLayer.textData.fontSize}px`,
                minHeight: `${Math.max(activeTextLayer.height, activeTextLayer.textData.fontSize + 24)}px`,
                padding: `${TEXT_LAYER_PADDING_Y}px ${TEXT_LAYER_PADDING_X}px`,
              }}
              value={activeTextLayer.textData.content}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}
