import ExpoModulesCore
import UIKit
import Vision

// 손글씨 획을 그림으로 그려 Apple Vision 글자 인식(한국어 포함)으로 읽는다. 인터넷 없이 기기 안에서.
public class InkRecognizerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("InkRecognizer")

    // 애플은 받을 모델이 없다
    AsyncFunction("statusAsync") { (_: String) -> String in
      if #available(iOS 16.0, *) { return "available" }
      return "unavailable"
    }
    AsyncFunction("prepareAsync") { (_: String) -> String in
      if #available(iOS 16.0, *) { return "available" }
      return "unavailable"
    }

    // strokes: [[x, y, x, y, …], …] (pt), width: 펜 굵기(pt)
    AsyncFunction("recognizeAsync") { (strokes: [[Double]], width: Double, lang: String) async throws -> String in
      guard #available(iOS 16.0, *) else { return "" }
      guard let image = InkRecognizerModule.render(strokes, width: width)?.cgImage else { return "" }
      return try await withCheckedThrowingContinuation { cont in
        let req = VNRecognizeTextRequest { req, err in
          if let err = err {
            cont.resume(throwing: err)
            return
          }
          let lines = (req.results as? [VNRecognizedTextObservation] ?? [])
            .sorted { $0.boundingBox.minY > $1.boundingBox.minY }   // 위에서 아래로
            .compactMap { $0.topCandidates(1).first?.string }
          cont.resume(returning: lines.joined(separator: "\n"))
        }
        req.recognitionLevel = .accurate
        req.usesLanguageCorrection = true
        req.recognitionLanguages = lang.hasPrefix("ko") ? ["ko-KR", "en-US"] : ["en-US", "ko-KR"]
        do {
          try VNImageRequestHandler(cgImage: image, options: [:]).perform([req])
        } catch {
          cont.resume(throwing: error)
        }
      }
    }
  }

  /// 획들을 흰 바탕에 검은 선으로 (글자 인식이 잘 되게 넉넉한 여백과 해상도로)
  static func render(_ strokes: [[Double]], width: Double) -> UIImage? {
    var minX = Double.infinity, minY = Double.infinity, maxX = -Double.infinity, maxY = -Double.infinity
    for s in strokes {
      var i = 0
      while i + 1 < s.count {
        minX = min(minX, s[i]); maxX = max(maxX, s[i])
        minY = min(minY, s[i + 1]); maxY = max(maxY, s[i + 1])
        i += 2
      }
    }
    if !minX.isFinite { return nil }
    let pad = 12.0
    let w = maxX - minX + pad * 2, h = maxY - minY + pad * 2
    let scale = max(1.0, min(6.0, 900.0 / max(w, h)))
    let size = CGSize(width: w * scale, height: h * scale)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    return UIGraphicsImageRenderer(size: size, format: format).image { ctx in
      UIColor.white.setFill()
      ctx.fill(CGRect(origin: .zero, size: size))
      let c = ctx.cgContext
      c.setStrokeColor(UIColor.black.cgColor)
      c.setLineWidth(CGFloat(max(1.5, width) * scale))
      c.setLineCap(.round)
      c.setLineJoin(.round)
      for s in strokes where s.count >= 2 {
        c.beginPath()
        c.move(to: CGPoint(x: (s[0] - minX + pad) * scale, y: (s[1] - minY + pad) * scale))
        var i = 2
        while i + 1 < s.count {
          c.addLine(to: CGPoint(x: (s[i] - minX + pad) * scale, y: (s[i + 1] - minY + pad) * scale))
          i += 2
        }
        if s.count == 2 { c.addLine(to: CGPoint(x: (s[0] - minX + pad) * scale + 0.5, y: (s[1] - minY + pad) * scale)) }
        c.strokePath()
      }
    }
  }
}
