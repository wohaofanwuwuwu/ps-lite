import { useEffect, useMemo, useRef } from 'react'
import { useEditorStore } from '../store/editorStore'
import { rgbaToHex } from '../utils/color'
import { applyLayerTransform, compositeLayers, drawLine, fillCanvas, toLayerLocalPoint } from '../utils/canvas'
import type { CropRect, Point } from '../types'

interface EditorCanvasProps {
  compositeCanvasRef: React.RefObject<HTMLCanvasElement | null>
}

const normalizeRect = (start: Point, end: Point): CropRect => ({
  x: Math.round(Math.min(start.x, end.x)),
  y: Math.round(Math.min(start.y, end.y)),
  width: Math.round(Math.abs(end.x - start.x)),
  height: Math.round(Math.abs(end.y - start.y)),
})

export function EditorCanvas({ compositeCanvasRef }: EditorCanvasProps) {
  const {
    tasks,
    activeTaskId,
    activeTool,
    color,
    brushSize,
    mutateCurrentLayer,
    setCurrentLayerTransform,
    setColor,
    setHoverPoint,
    setPendingCrop,
    setPan,
    setStatusMessage,
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

  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const drawingRef = useRef(false)
  const panningRef = useRef(false)
  const lastPointRef = useRef<Point | null>(null)
  const cropStartRef = useRef<Point | null>(null)
  const moveStartRef = useRef<{ x: number; y: number; offsetX: number; offsetY: number } | null>(null)
  const panStartRef = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null)
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

    if (currentLayer && activeTool === 'move') {
      ctx.save()
      ctx.strokeStyle = '#f8fafc'
      ctx.lineWidth = 1.5
      ctx.setLineDash([8, 6])
      applyLayerTransform(ctx, currentLayer)
      ctx.strokeRect(0, 0, currentLayer.canvas.width, currentLayer.canvas.height)
      ctx.restore()
    }
  }, [activeTool, brushSize, canvasHeight, canvasWidth, currentLayer, currentTask, hoverPoint, pendingCrop, renderVersion])

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
          brushSize / layer.scale,
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
          brushSize / layer.scale,
          'destination-out',
        ),
      )
      return
    }

    if (activeTool === 'move' && currentLayer) {
      moveStartRef.current = {
        x: point.x,
        y: point.y,
        offsetX: currentLayer.offsetX,
        offsetY: currentLayer.offsetY,
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
          brushSize / layer.scale,
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
      </div>
    </div>
  )
}
