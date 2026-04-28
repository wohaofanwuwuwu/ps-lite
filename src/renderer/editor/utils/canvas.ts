import type { CropRect, LayerModel, LayerSnapshot, Point, TextLayerData } from '../types'

export const createCanvas = (width: number, height: number) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

export const DEFAULT_TEXT_FONT_FAMILY = '"Segoe UI", sans-serif'
export const TEXT_LAYER_PADDING_X = 12
export const TEXT_LAYER_PADDING_Y = 10
const TEXT_LINE_HEIGHT = 1.25

const measureTextLayer = (textData: TextLayerData) => {
  const canvas = createCanvas(1, 1)
  const ctx = canvas.getContext('2d')
  const lines = textData.content.split(/\r?\n/)
  const font = `${textData.fontSize}px ${textData.fontFamily}`
  if (!ctx) {
    const lineHeight = Math.max(Math.ceil(textData.fontSize * TEXT_LINE_HEIGHT), textData.fontSize + 4)
    return {
      lines,
      lineHeight,
      width: Math.max(textData.fontSize * 2, 64),
      height: Math.max(lineHeight + TEXT_LAYER_PADDING_Y * 2, 40),
    }
  }

  ctx.font = font
  const maxLineWidth = Math.max(
    ...lines.map((line) => Math.ceil(ctx.measureText(line || ' ').width)),
    textData.fontSize,
  )
  const lineHeight = Math.max(Math.ceil(textData.fontSize * TEXT_LINE_HEIGHT), textData.fontSize + 4)

  return {
    lines,
    lineHeight,
    width: Math.max(maxLineWidth + TEXT_LAYER_PADDING_X * 2, 64),
    height: Math.max(lines.length * lineHeight + TEXT_LAYER_PADDING_Y * 2, 40),
  }
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
  type: 'bitmap',
  visible: true,
  opacity: 1,
  width,
  height,
  offsetX: 0,
  offsetY: 0,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
  textData: null,
  canvas: createCanvas(width, height),
})

export const renderTextLayer = (layer: LayerModel) => {
  if (layer.type !== 'text' || !layer.textData) {
    return layer
  }

  const { lines, lineHeight, width, height } = measureTextLayer(layer.textData)
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return layer
  }

  ctx.clearRect(0, 0, width, height)
  ctx.font = `${layer.textData.fontSize}px ${layer.textData.fontFamily}`
  ctx.fillStyle = layer.textData.color
  ctx.textBaseline = 'top'

  lines.forEach((line, index) => {
    ctx.fillText(line, TEXT_LAYER_PADDING_X, TEXT_LAYER_PADDING_Y + index * lineHeight)
  })

  layer.canvas = canvas
  layer.width = width
  layer.height = height
  return layer
}

export const createTextLayer = (
  name: string,
  id: string,
  textData: TextLayerData,
  offsetX = 0,
  offsetY = 0,
): LayerModel =>
  renderTextLayer({
    id,
    name,
    type: 'text',
    visible: true,
    opacity: 1,
    width: 1,
    height: 1,
    offsetX,
    offsetY,
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    textData: { ...textData },
    canvas: createCanvas(1, 1),
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
    type: snapshot.type,
    visible: snapshot.visible,
    opacity: snapshot.opacity,
    width: snapshot.width,
    height: snapshot.height,
    offsetX: snapshot.offsetX,
    offsetY: snapshot.offsetY,
    scaleX: snapshot.scaleX,
    scaleY: snapshot.scaleY,
    rotation: snapshot.rotation,
    textData: snapshot.textData ? { ...snapshot.textData } : null,
    canvas,
  }
}

export interface Matrix2D {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180

export const getLayerMatrix = (
  layer: Pick<LayerModel, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY' | 'rotation'>,
): Matrix2D => {
  const radians = degreesToRadians(layer.rotation)
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)
  return {
    a: cos * layer.scaleX,
    b: sin * layer.scaleX,
    c: -sin * layer.scaleY,
    d: cos * layer.scaleY,
    e: layer.offsetX,
    f: layer.offsetY,
  }
}

export const invertMatrix = (matrix: Matrix2D): Matrix2D => {
  const det = matrix.a * matrix.d - matrix.b * matrix.c
  if (!det) {
    return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }
  }
  return {
    a: matrix.d / det,
    b: -matrix.b / det,
    c: -matrix.c / det,
    d: matrix.a / det,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / det,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / det,
  }
}

export const multiplyMatrices = (left: Matrix2D, right: Matrix2D): Matrix2D => ({
  a: left.a * right.a + left.c * right.b,
  b: left.b * right.a + left.d * right.b,
  c: left.a * right.c + left.c * right.d,
  d: left.b * right.c + left.d * right.d,
  e: left.a * right.e + left.c * right.f + left.e,
  f: left.b * right.e + left.d * right.f + left.f,
})

export const toLayerLocalPoint = (
  layer: Pick<LayerModel, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY' | 'rotation'>,
  point: Point,
): Point => {
  const matrix = invertMatrix(getLayerMatrix(layer))
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f,
  }
}

export const applyLayerTransform = (
  ctx: CanvasRenderingContext2D,
  layer: Pick<LayerModel, 'offsetX' | 'offsetY' | 'scaleX' | 'scaleY' | 'rotation'>,
) => {
  const matrix = getLayerMatrix(layer)
  ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f)
}

export const getLayerScaleMagnitude = (layer: Pick<LayerModel, 'scaleX' | 'scaleY'>) =>
  Math.max((Math.abs(layer.scaleX) + Math.abs(layer.scaleY)) / 2, 0.1)

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
    applyLayerTransform(ctx, layer)
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
  compositeOperation: GlobalCompositeOperation = 'source-over',
) => {
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return
  }

  ctx.save()
  ctx.globalCompositeOperation = compositeOperation
  ctx.strokeStyle = color
  ctx.lineWidth = size
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(start.x, start.y)
  ctx.lineTo(end.x, end.y)
  ctx.stroke()
  ctx.restore()
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

const clampTolerance = (value: number) => Math.min(255, Math.max(0, Math.round(value)))

const matchesRgb = (
  r: number,
  g: number,
  b: number,
  from: [number, number, number],
  tolerance: number,
) => {
  if (tolerance <= 0) {
    return r === from[0] && g === from[1] && b === from[2]
  }
  return (
    Math.abs(r - from[0]) <= tolerance &&
    Math.abs(g - from[1]) <= tolerance &&
    Math.abs(b - from[2]) <= tolerance
  )
}

/** Replaces RGB-matching pixels on the canvas. Transparency option sets RGBA to 0. Returns count of pixels changed. */
export const replaceColorInCanvas = (
  canvas: HTMLCanvasElement,
  from: [number, number, number],
  options: {
    tolerance: number
    toTransparent: boolean
    toRgb?: [number, number, number]
  },
): number => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) {
    return 0
  }
  const { width, height } = canvas
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  const tol = clampTolerance(options.tolerance)
  let count = 0
  let tr = 0
  let tg = 0
  let tb = 0
  if (!options.toTransparent && options.toRgb) {
    tr = options.toRgb[0]
    tg = options.toRgb[1]
    tb = options.toRgb[2]
  }
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index]!
    const g = data[index + 1]!
    const b = data[index + 2]!
    if (!matchesRgb(r, g, b, from, tol)) {
      continue
    }
    count += 1
    if (options.toTransparent) {
      data[index] = 0
      data[index + 1] = 0
      data[index + 2] = 0
      data[index + 3] = 0
    } else {
      data[index] = tr
      data[index + 1] = tg
      data[index + 2] = tb
      data[index + 3] = 255
    }
  }
  if (count > 0) {
    ctx.putImageData(imageData, 0, 0)
  }
  return count
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

export const getPolygonBoundingRect = (points: Point[]): CropRect => {
  if (!points.length) {
    return { x: 0, y: 0, width: 0, height: 0 }
  }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const point of points) {
    if (point.x < minX) minX = point.x
    if (point.y < minY) minY = point.y
    if (point.x > maxX) maxX = point.x
    if (point.y > maxY) maxY = point.y
  }
  const x = Math.floor(minX)
  const y = Math.floor(minY)
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(maxX) - x),
    height: Math.max(1, Math.ceil(maxY) - y),
  }
}

export const cropLayerByPolygon = (layer: LayerModel, points: Point[], rect: CropRect) => {
  const next = createCanvas(rect.width, rect.height)
  const ctx = next.getContext('2d')
  if (!ctx || points.length < 3) {
    return layer.canvas
  }
  ctx.save()
  ctx.beginPath()
  points.forEach((point, index) => {
    const x = point.x - rect.x
    const y = point.y - rect.y
    if (index === 0) {
      ctx.moveTo(x, y)
    } else {
      ctx.lineTo(x, y)
    }
  })
  ctx.closePath()
  ctx.clip()
  ctx.drawImage(layer.canvas, -rect.x, -rect.y)
  ctx.restore()
  return next
}
