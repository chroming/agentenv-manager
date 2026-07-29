#!/usr/bin/env swift

import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

struct CaptureContract: Decodable {
  let file: String
  let maxChangedPixelRatio: Double?
}

struct VisualContract: Decodable {
  let formatVersion: Int
  let channelTolerance: Int
  let pixelShiftTolerance: Int?
  let maxChangedPixelRatio: Double
  let captures: [CaptureContract]
}

struct CaptureResult: Encodable {
  let file: String
  let width: Int
  let height: Int
  let changedPixels: Int
  let changedPixelRatio: Double
  let maxChangedPixelRatio: Double
  let passed: Bool
  let reason: String?
  let diff: String?
}

struct VisualReport: Encodable {
  let generatedAt: String
  let baselineDirectory: String
  let currentDirectory: String
  let channelTolerance: Int
  let pixelShiftTolerance: Int
  let passed: Bool
  let captures: [CaptureResult]
}

struct PixelImage {
  let width: Int
  let height: Int
  var pixels: [UInt8]
}

enum VisualComparisonError: Error, CustomStringConvertible {
  case invalidArguments(String)
  case invalidContract(String)
  case unreadableImage(String)
  case unwritableImage(String)

  var description: String {
    switch self {
    case .invalidArguments(let message),
         .invalidContract(let message),
         .unreadableImage(let message),
         .unwritableImage(let message):
      return message
    }
  }
}

func parseArguments(_ arguments: [String]) throws -> [String: String] {
  var values: [String: String] = [:]
  var index = 0
  while index < arguments.count {
    let key = arguments[index]
    guard ["--baseline", "--config", "--current", "--output"].contains(key) else {
      throw VisualComparisonError.invalidArguments("Unknown argument: \(key)")
    }
    guard index + 1 < arguments.count else {
      throw VisualComparisonError.invalidArguments("Missing value for \(key)")
    }
    values[key] = arguments[index + 1]
    index += 2
  }
  for key in ["--baseline", "--config", "--current", "--output"] where values[key] == nil {
    throw VisualComparisonError.invalidArguments("Missing required argument: \(key)")
  }
  return values
}

func loadImage(_ url: URL) throws -> PixelImage {
  guard
    let source = CGImageSourceCreateWithURL(url as CFURL, nil),
    let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
  else {
    throw VisualComparisonError.unreadableImage("Could not decode image: \(url.path)")
  }
  let width = image.width
  let height = image.height
  var pixels = [UInt8](repeating: 0, count: width * height * 4)
  guard let context = CGContext(
    data: &pixels,
    width: width,
    height: height,
    bitsPerComponent: 8,
    bytesPerRow: width * 4,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue |
      CGBitmapInfo.byteOrder32Big.rawValue
  ) else {
    throw VisualComparisonError.unreadableImage(
      "Could not create pixel buffer for: \(url.path)"
    )
  }
  context.interpolationQuality = .none
  context.draw(image, in: CGRect(x: 0, y: 0, width: width, height: height))
  return PixelImage(width: width, height: height, pixels: pixels)
}

func writeImage(_ image: PixelImage, to url: URL) throws {
  var pixels = image.pixels
  guard let context = CGContext(
    data: &pixels,
    width: image.width,
    height: image.height,
    bitsPerComponent: 8,
    bytesPerRow: image.width * 4,
    space: CGColorSpaceCreateDeviceRGB(),
    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue |
      CGBitmapInfo.byteOrder32Big.rawValue
  ), let output = context.makeImage(),
  let destination = CGImageDestinationCreateWithURL(
    url as CFURL,
    UTType.png.identifier as CFString,
    1,
    nil
  ) else {
    throw VisualComparisonError.unwritableImage(
      "Could not create diff image: \(url.path)"
    )
  }
  CGImageDestinationAddImage(destination, output, nil)
  guard CGImageDestinationFinalize(destination) else {
    throw VisualComparisonError.unwritableImage(
      "Could not write diff image: \(url.path)"
    )
  }
}

func compare(
  baseline: PixelImage,
  current: PixelImage,
  tolerance: Int,
  pixelShiftTolerance: Int
) -> (changedPixels: Int, diff: PixelImage) {
  var diffPixels = current.pixels
  var changed = [Bool](repeating: false, count: current.width * current.height)

  func colorsMatch(_ firstOffset: Int, _ secondOffset: Int) -> Bool {
    !(0..<4).contains { channel in
      abs(
        Int(baseline.pixels[firstOffset + channel]) -
          Int(current.pixels[secondOffset + channel])
      ) > tolerance
    }
  }

  func markUnmatched(sourceIsBaseline: Bool) {
    for y in 0..<current.height {
      for x in 0..<current.width {
        let pixelIndex = y * current.width + x
        let sourceOffset = pixelIndex * 4
        var matched = false
        let minimumY = max(0, y - pixelShiftTolerance)
        let maximumY = min(current.height - 1, y + pixelShiftTolerance)
        let minimumX = max(0, x - pixelShiftTolerance)
        let maximumX = min(current.width - 1, x + pixelShiftTolerance)
        for candidateY in minimumY...maximumY {
          for candidateX in minimumX...maximumX {
            let candidateOffset = (candidateY * current.width + candidateX) * 4
            let baselineOffset = sourceIsBaseline ? sourceOffset : candidateOffset
            let currentOffset = sourceIsBaseline ? candidateOffset : sourceOffset
            if colorsMatch(baselineOffset, currentOffset) {
              matched = true
              break
            }
          }
          if matched {
            break
          }
        }
        if !matched {
          changed[pixelIndex] = true
        }
      }
    }
  }

  markUnmatched(sourceIsBaseline: true)
  markUnmatched(sourceIsBaseline: false)
  var changedPixels = 0
  for pixelIndex in 0..<changed.count {
    let offset = pixelIndex * 4
    if changed[pixelIndex] {
      changedPixels += 1
      diffPixels[offset] = 255
      diffPixels[offset + 1] = 35
      diffPixels[offset + 2] = 105
      diffPixels[offset + 3] = 255
    } else {
      for channel in 0..<3 {
        diffPixels[offset + channel] = UInt8(
          min(255, 210 + Int(current.pixels[offset + channel]) / 6)
        )
      }
      diffPixels[offset + 3] = 255
    }
  }
  return (
    changedPixels,
    PixelImage(width: current.width, height: current.height, pixels: diffPixels)
  )
}

do {
  let arguments = try parseArguments(Array(CommandLine.arguments.dropFirst()))
  let baselineDirectory = URL(fileURLWithPath: arguments["--baseline"]!)
  let currentDirectory = URL(fileURLWithPath: arguments["--current"]!)
  let outputDirectory = URL(fileURLWithPath: arguments["--output"]!)
  let contractData = try Data(
    contentsOf: URL(fileURLWithPath: arguments["--config"]!)
  )
  let contract = try JSONDecoder().decode(VisualContract.self, from: contractData)
  guard contract.formatVersion == 1 else {
    throw VisualComparisonError.invalidContract(
      "Unsupported visual contract version: \(contract.formatVersion)"
    )
  }
  guard (0...255).contains(contract.channelTolerance) else {
    throw VisualComparisonError.invalidContract(
      "Visual channel tolerance must be between 0 and 255."
    )
  }
  let pixelShiftTolerance = contract.pixelShiftTolerance ?? 0
  guard (0...2).contains(pixelShiftTolerance) else {
    throw VisualComparisonError.invalidContract(
      "Visual pixel-shift tolerance must be between 0 and 2."
    )
  }
  try FileManager.default.createDirectory(
    at: outputDirectory,
    withIntermediateDirectories: true
  )

  var results: [CaptureResult] = []
  for capture in contract.captures {
    let baselineURL = baselineDirectory.appendingPathComponent(capture.file)
    let currentURL = currentDirectory.appendingPathComponent(capture.file)
    let limit = capture.maxChangedPixelRatio ?? contract.maxChangedPixelRatio
    do {
      let baseline = try loadImage(baselineURL)
      let current = try loadImage(currentURL)
      guard baseline.width == current.width && baseline.height == current.height else {
        results.append(CaptureResult(
          file: capture.file,
          width: current.width,
          height: current.height,
          changedPixels: current.width * current.height,
          changedPixelRatio: 1,
          maxChangedPixelRatio: limit,
          passed: false,
          reason: "Image dimensions differ from the baseline.",
          diff: nil
        ))
        continue
      }
      let comparison = compare(
        baseline: baseline,
        current: current,
        tolerance: contract.channelTolerance,
        pixelShiftTolerance: pixelShiftTolerance
      )
      let pixelCount = max(1, current.width * current.height)
      let ratio = Double(comparison.changedPixels) / Double(pixelCount)
      let passed = ratio <= limit
      var diffPath: String?
      if !passed {
        let diffURL = outputDirectory.appendingPathComponent(
          capture.file.replacingOccurrences(of: ".png", with: ".diff.png")
        )
        try writeImage(comparison.diff, to: diffURL)
        diffPath = diffURL.path
      }
      results.append(CaptureResult(
        file: capture.file,
        width: current.width,
        height: current.height,
        changedPixels: comparison.changedPixels,
        changedPixelRatio: ratio,
        maxChangedPixelRatio: limit,
        passed: passed,
        reason: passed ? nil : "Changed pixel ratio exceeds the visual contract.",
        diff: diffPath
      ))
    } catch {
      results.append(CaptureResult(
        file: capture.file,
        width: 0,
        height: 0,
        changedPixels: 0,
        changedPixelRatio: 1,
        maxChangedPixelRatio: limit,
        passed: false,
        reason: String(describing: error),
        diff: nil
      ))
    }
  }

  let passed = results.allSatisfy(\.passed)
  let formatter = ISO8601DateFormatter()
  let report = VisualReport(
    generatedAt: formatter.string(from: Date()),
    baselineDirectory: baselineDirectory.path,
    currentDirectory: currentDirectory.path,
    channelTolerance: contract.channelTolerance,
    pixelShiftTolerance: pixelShiftTolerance,
    passed: passed,
    captures: results
  )
  let encoder = JSONEncoder()
  encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
  let reportData = try encoder.encode(report)
  let reportURL = outputDirectory.appendingPathComponent("visual-report.json")
  try reportData.write(to: reportURL, options: .atomic)

  for result in results {
    let percentage = String(format: "%.3f%%", result.changedPixelRatio * 100)
    let limit = String(format: "%.3f%%", result.maxChangedPixelRatio * 100)
    print("\(result.passed ? "PASS" : "FAIL") \(result.file) \(percentage) <= \(limit)")
  }
  print("Visual comparison report: \(reportURL.path)")
  if !passed {
    exit(1)
  }
} catch {
  FileHandle.standardError.write(
    Data("Visual comparison failed: \(error)\n".utf8)
  )
  exit(1)
}
