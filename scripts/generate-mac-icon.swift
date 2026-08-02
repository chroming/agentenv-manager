#!/usr/bin/env swift

import AppKit
import CoreGraphics
import Foundation

enum IconError: Error, CustomStringConvertible {
  case invalidSource(String)
  case renderFailed
  case iconutilFailed(Int32)

  var description: String {
    switch self {
    case .invalidSource(let path):
      return "Unable to read icon source at \(path)"
    case .renderFailed:
      return "Unable to render the macOS icon"
    case .iconutilFailed(let status):
      return "iconutil failed with status \(status)"
    }
  }
}

let fileManager = FileManager.default
let root = URL(fileURLWithPath: fileManager.currentDirectoryPath, isDirectory: true)
let sourceURL = root.appendingPathComponent("src/renderer/assets/app-icon.png")
let buildURL = root.appendingPathComponent("build", isDirectory: true)
let pngURL = buildURL.appendingPathComponent("icon.png")
let icnsURL = buildURL.appendingPathComponent("icon.icns")
let canvasSize = 1024

func superellipsePath(size: CGFloat, inset: CGFloat, exponent: CGFloat) -> CGPath {
  let path = CGMutablePath()
  let radius = (size / 2) - inset
  let center = size / 2
  let power = 2 / exponent
  let steps = 720

  for step in 0...steps {
    let angle = CGFloat(step) / CGFloat(steps) * 2 * .pi
    let cosine = cos(angle)
    let sine = sin(angle)
    let x = center + radius * (cosine < 0 ? -1 : 1) * pow(abs(cosine), power)
    let y = center + radius * (sine < 0 ? -1 : 1) * pow(abs(sine), power)
    if step == 0 {
      path.move(to: CGPoint(x: x, y: y))
    } else {
      path.addLine(to: CGPoint(x: x, y: y))
    }
  }
  path.closeSubpath()
  return path
}

func renderImage(source: CGImage, size: Int, masked: Bool) throws -> CGImage {
  guard let context = CGContext(
    data: nil,
    width: size,
    height: size,
    bitsPerComponent: 8,
    bytesPerRow: 0,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
  ) else {
    throw IconError.renderFailed
  }

  context.clear(CGRect(x: 0, y: 0, width: size, height: size))
  context.setAllowsAntialiasing(true)
  context.setShouldAntialias(true)
  if masked {
    let scale = CGFloat(size) / CGFloat(canvasSize)
    context.addPath(superellipsePath(size: CGFloat(size), inset: 12 * scale, exponent: 4))
    context.clip()
  }
  context.interpolationQuality = .high
  context.draw(source, in: CGRect(x: 0, y: 0, width: size, height: size))

  guard let image = context.makeImage() else {
    throw IconError.renderFailed
  }
  return image
}

func writePNG(_ image: CGImage, to url: URL) throws {
  let bitmap = NSBitmapImageRep(cgImage: image)
  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    throw IconError.renderFailed
  }
  try data.write(to: url, options: .atomic)
}

guard
  let sourceImage = NSImage(contentsOf: sourceURL),
  let sourceData = sourceImage.tiffRepresentation,
  let sourceBitmap = NSBitmapImageRep(data: sourceData),
  let source = sourceBitmap.cgImage
else {
  throw IconError.invalidSource(sourceURL.path)
}

try fileManager.createDirectory(at: buildURL, withIntermediateDirectories: true)
let maskedIcon = try renderImage(source: source, size: canvasSize, masked: true)
let maskedBitmap = NSBitmapImageRep(cgImage: maskedIcon)
guard
  (maskedBitmap.colorAt(x: 0, y: 0)?.alphaComponent ?? 1) == 0,
  (maskedBitmap.colorAt(x: canvasSize / 2, y: canvasSize / 2)?.alphaComponent ?? 0) > 0.99
else {
  throw IconError.renderFailed
}
try writePNG(maskedIcon, to: pngURL)

let temporaryRoot = fileManager.temporaryDirectory
  .appendingPathComponent("agentenv-icon-\(UUID().uuidString)", isDirectory: true)
let iconsetURL = temporaryRoot.appendingPathComponent("AgentEnv.iconset", isDirectory: true)
try fileManager.createDirectory(at: iconsetURL, withIntermediateDirectories: true)
defer { try? fileManager.removeItem(at: temporaryRoot) }

let iconsetFiles: [(String, Int)] = [
  ("icon_16x16.png", 16),
  ("icon_16x16@2x.png", 32),
  ("icon_32x32.png", 32),
  ("icon_32x32@2x.png", 64),
  ("icon_128x128.png", 128),
  ("icon_128x128@2x.png", 256),
  ("icon_256x256.png", 256),
  ("icon_256x256@2x.png", 512),
  ("icon_512x512.png", 512),
  ("icon_512x512@2x.png", 1024)
]

for (name, size) in iconsetFiles {
  let resized = try renderImage(source: maskedIcon, size: size, masked: false)
  try writePNG(resized, to: iconsetURL.appendingPathComponent(name))
}

let iconutil = Process()
iconutil.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
iconutil.arguments = ["-c", "icns", iconsetURL.path, "-o", icnsURL.path]
try iconutil.run()
iconutil.waitUntilExit()
guard iconutil.terminationStatus == 0 else {
  throw IconError.iconutilFailed(iconutil.terminationStatus)
}

print("Generated \(pngURL.path) and \(icnsURL.path)")
