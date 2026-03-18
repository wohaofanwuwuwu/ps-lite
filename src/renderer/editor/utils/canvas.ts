import type { CropRect, LayerModel, LayerSnapshot, Point } from '../types'

export const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export const cloneCanvas = (source: HTMLCanvasElement) => {
  const canvas = createCanvas(source.width, source.height)
  const ctx = canvas.getContext('2d')
  if (ctx) {
    ctx.drawImage(source, 0, 0)
  }
  return canvas
}

export const createLayer = (width: number, height: number, name: string, id: string): LayerModel => ({
  id,
  name,
  visible: true,
  opacity: 1,
  width,
  height,
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  canvas: createCanvas(width, height),
})

export const resizeLayerCanvas = (layer: LayerModel, width: number, height: number) => {
  if (layer.canvas.width === width && layer.canvas.height === height) {
    return layer.canvas
  }

  const next = createCanvas(width, height)
  const ctx = next.getContext('2d')
  if (ctx) {
    ctx.drawImage(layer.canvas, 0, 0)
  }
  return next
}

export const snapshotLayer = (layer: LayerModel): LayerSnapshot => {
  const ctx = layer.canvas.getContext('2d', { willReadFrequently: true })
  const imageData = ctx!.getImageData(0, 0, layer.canvas.width, layer.canvas.height)
  return {
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    opacity: layer.opacity,
    width: layer.width,
    height: layer.height,
    offsetX: layer.offsetX,
    offsetY: layer.offsetY,
    scale: layer.scale,
    imageData,
  }
}

export const restoreLayer = (snapshot: LayerSnapshot): LayerModel => {
  const canvas = createCanvas(snapshot.width, snapshot.height)
  const ctx = canvas.getContext('2d')
  ctx!.putImageData(snapshot.imageData, 0, 0)
  return {
    id: snapshot.id,
    name: snapshot.name,
    visible: snapshot.visible,
    opacity: snapshot.opacity,
    width: snapshot.width,
    height: snapshot.height,
    offsetX: snapshot.offsetX,
    offsetY: snapshot.offsetY,
    scale: snapshot.scale,
    canvas,
  }
}

export const compositeLayers = (
  target: HTMLCanvasElement,
  layers: LayerModel[],
  width: number,
  height: number,
) => {
  target.width = width
  target.height = height
  const ctx = target.getContext('2d')
  if (!ctx) {
    return
  }

  ctx.clearRect(0, 0, width, height)
  for (const layer of layers) {
    if (!layer.visible) {
      continue
    }
    ctx.save()
    ctx.globalAlpha = layer.opacity
    ctx.translate(layer.offsetX, layer.offsetY)
    ctx.scale(layer.scale, layer.scale)
    ctx.drawImage(layer.canvas, 0, 0)
    ctx.restore()
  }
  ctx.globalAlpha = 1
}

export const drawLine = (
  canvas: HTMLCanvasElement,
  start: Point,
  end: Point,
  color: string,
  size: number,
) => {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }

  ctx.strokeStyle = color
  ctx.lineWidth = size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()
}

export const fillCanvas = (canvas: HTMLCanvasElement, point: Point, color: [number, number, number, number]) => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return
  }

  const { width, height } = canvas
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  const startX = Math.floor(point.x)
  const startY = Math.floor(point.y)
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) {
    return
  }

  const startIndex = (startY * width + startX) * 4
  const target = [
    data[startIndex],
    data[startIndex + 1],
    data[startIndex + 2],
    data[startIndex + 3],
  ] as const

  if (target.every((value, index) => value === color[index])) {
    return
  }

  const stack: number[] = [startX, startY]
  while (stack.length) {
    const y = stack.pop()!
    const x = stack.pop()!
    const index = (y * width + x) * 4

    if (
      data[index] !== target[0] ||
      data[index + 1] !== target[1] ||
      data[index + 2] !== target[2] ||
      data[index + 3] !== target[3]
    ) {
      continue
    }

    data[index] = color[0]
    data[index + 1] = color[1]
    data[index + 2] = color[2]
    data[index + 3] = color[3]

    if (x > 0) stack.push(x - 1, y)
    if (x < width - 1) stack.push(x + 1, y)
    if (y > 0) stack.push(x, y - 1)
    if (y < height - 1) stack.push(x, y + 1)
  }

  ctx.putImageData(imageData, 0, 0)
}

export const cropLayerCanvas = (layer: LayerModel, rect: CropRect) => {
  const next = createCanvas(rect.width, rect.height)
  const ctx = next.getContext('2d')
  if (!ctx) {
    return layer.canvas
  }
  ctx.drawImage(layer.canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height)
  return next
}
