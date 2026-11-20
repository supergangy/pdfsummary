import ExpoModulesCore
import PDFKit
import UIKit
import Vision

// PDF 쪽 크기를 읽고, 쪽을 그림(JPEG)으로 그린다. 필기 화면의 바탕으로 쓴다.
public class PdfPagesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PdfPages")

    // [{"w":…, "h":…}, …] (pt, 회전 반영)
    AsyncFunction("infoAsync") { (uri: String) throws -> String in
      let doc = try PdfPagesModule.open(uri)
      var out: [[String: Double]] = []
      for i in 0..<doc.pageCount {
        guard let page = doc.page(at: i) else { continue }
        let s = PdfPagesModule.size(page)
        out.append(["w": Double(s.width), "h": Double(s.height)])
      }
      let data = try JSONSerialization.data(withJSONObject: out)
      return String(data: data, encoding: .utf8) ?? "[]"
    }

    // index 쪽의 글자와 글자 상자: [["가", x0, y0, x1, y1], …] (화면에 보이는 쪽 좌표, 왼쪽 위가 0)
    AsyncFunction("textAsync") { (uri: String, index: Int) throws -> String in
      let doc = try PdfPagesModule.open(uri)
      guard let page = doc.page(at: index) else { return "[]" }
      let text = (page.string ?? "") as NSString
      let size = PdfPagesModule.size(page)
      let t = page.transform(for: .cropBox)   // 쪽 공간 → 자르기 상자 공간 (회전 포함, 왼쪽 아래가 0)
      var out: [[Any]] = []
      out.reserveCapacity(text.length)
      for i in 0..<text.length {
        let ch = text.substring(with: NSRange(location: i, length: 1))
        let r = page.characterBounds(at: i).applying(t)
        if r.isNull || r.isInfinite { continue }
        let x0 = Double(r.minX), x1 = Double(r.maxX)
        let y0 = Double(size.height - r.maxY), y1 = Double(size.height - r.minY)
        out.append([ch, round2(x0), round2(y0), round2(x1), round2(y1)])
      }
      let data = try JSONSerialization.data(withJSONObject: out)
      return String(data: data, encoding: .utf8) ?? "[]"
    }

    // 글자 인식(OCR)으로 쪽 글자와 글자 상자 (스캔본처럼 글자 층이 없는 PDF용). textAsync와 같은 모양.
    AsyncFunction("ocrAsync") { (uri: String, index: Int, widthPx: Int) throws -> String in
      guard #available(iOS 16.0, *) else { return "[]" } // 한국어 글자 인식은 iOS 16부터
      let doc = try PdfPagesModule.open(uri)
      guard let page = doc.page(at: index) else { return "[]" }
      let s = PdfPagesModule.size(page)
      let w = CGFloat(max(800, min(widthPx, 3200)))
      let h = (w * s.height / max(s.width, 1)).rounded()
      let thumb = page.thumbnail(of: CGSize(width: w, height: h), for: .cropBox)
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      format.opaque = true
      let flat = UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: format).image { ctx in
        UIColor.white.setFill()
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        thumb.draw(in: CGRect(x: 0, y: 0, width: w, height: h))
      }
      guard let cg = flat.cgImage else { return "[]" }
      let req = VNRecognizeTextRequest()
      req.recognitionLevel = .accurate
      req.recognitionLanguages = ["ko-KR", "en-US"]
      req.usesLanguageCorrection = true
      try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
      var out: [[Any]] = []
      // Vision 상자는 0~1, 왼쪽 아래가 0 → 쪽 좌표(왼쪽 위가 0, pt)
      func toPage(_ r: CGRect) -> (Double, Double, Double, Double) {
        (Double(r.minX * s.width), Double((1 - r.maxY) * s.height), Double(r.maxX * s.width), Double((1 - r.minY) * s.height))
      }
      for obs in req.results ?? [] {
        guard let cand = obs.topCandidates(1).first else { continue }
        let str = cand.string
        var lastRight: Double? = nil
        var top = 0.0, bottom = 0.0
        // 낱말마다 상자를 받아 글자 수로 나눈다
        str.enumerateSubstrings(in: str.startIndex..<str.endIndex, options: .byWords) { word, range, _, _ in
          guard let word = word, let box = try? cand.boundingBox(for: range)?.boundingBox else { return }
          let (x0, y0, x1, y1) = toPage(box)
          top = y0
          bottom = y1
          if let lr = lastRight { out.append([" ", round2(lr), round2(y0), round2(x0), round2(y1)]) }
          let chars = Array(word)
          let cw = (x1 - x0) / Double(max(chars.count, 1))
          for (i, c) in chars.enumerated() {
            out.append([String(c), round2(x0 + cw * Double(i)), round2(y0), round2(x0 + cw * Double(i + 1)), round2(y1)])
          }
          lastRight = x1
        }
        if let lr = lastRight { out.append(["\n", round2(lr), round2(top), round2(lr), round2(bottom)]) }
      }
      let data = try JSONSerialization.data(withJSONObject: out)
      return String(data: data, encoding: .utf8) ?? "[]"
    }

    // index 쪽을 폭 widthPx 픽셀로 그려 outPath(파일 경로 또는 file:// 주소)에 저장
    AsyncFunction("renderAsync") { (uri: String, index: Int, widthPx: Int, outPath: String) throws -> String in
      let doc = try PdfPagesModule.open(uri)
      guard let page = doc.page(at: index) else {
        throw Exception(name: "PdfPageMissing", description: "\(index + 1)쪽이 없어요.", code: "ERR_PAGE")
      }
      let s = PdfPagesModule.size(page)
      let w = CGFloat(max(16, min(widthPx, 4096)))
      let h = (w * s.height / max(s.width, 1)).rounded()
      let image = page.thumbnail(of: CGSize(width: w, height: h), for: .cropBox)
      // 투명한 부분은 흰 종이로
      let format = UIGraphicsImageRendererFormat()
      format.scale = 1
      format.opaque = true
      let flat = UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: format).image { ctx in
        UIColor.white.setFill()
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        image.draw(in: CGRect(x: 0, y: 0, width: w, height: h))
      }
      guard let data = flat.jpegData(compressionQuality: 0.88) else {
        throw Exception(name: "PdfRenderFailed", description: "쪽을 그리지 못했어요.", code: "ERR_RENDER")
      }
      let url = PdfPagesModule.fileURL(outPath)
      try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
      try data.write(to: url, options: .atomic)
      return url.absoluteString
    }
  }

  static func fileURL(_ s: String) -> URL {
    if let u = URL(string: s), u.scheme == "file" { return u }
    return URL(fileURLWithPath: s)
  }

  static func open(_ uri: String) throws -> PDFDocument {
    guard let doc = PDFDocument(url: fileURL(uri)) else {
      throw Exception(name: "PdfOpenFailed", description: "PDF를 열 수 없어요.", code: "ERR_OPEN")
    }
    if doc.isLocked {
      throw Exception(name: "PdfLocked", description: "암호가 걸린 PDF예요.", code: "ERR_LOCKED")
    }
    return doc
  }

  static func size(_ page: PDFPage) -> CGSize {
    let b = page.bounds(for: .cropBox)
    let r = ((page.rotation % 360) + 360) % 360
    return (r == 90 || r == 270) ? CGSize(width: b.height, height: b.width) : b.size
  }
}

private func round2(_ v: Double) -> Double { (v * 100).rounded() / 100 }
