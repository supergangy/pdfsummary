import ExpoModulesCore
import PDFKit
import UIKit

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
