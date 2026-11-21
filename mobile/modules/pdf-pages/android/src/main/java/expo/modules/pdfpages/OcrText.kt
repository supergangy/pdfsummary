package expo.modules.pdfpages

import android.util.Log
import com.google.mlkit.vision.text.Text
import org.json.JSONArray

// ML Kit 글자 인식 결과 → [["가", x0, y0, x1, y1], …] (쪽 좌표 pt). 낱말 상자를 글자 수로 나눠 글자 상자를 만든다.
// 낱말 사이는 " ", 줄 끝은 "\n". 문단(블록) 차례는 ML Kit이 읽는 차례 그대로 (두 단 편집도 단마다).
internal object OcrText {
  fun json(text: Text, scale: Double): String {
    val out = JSONArray()
    // 글자 내용은 기록하지 않는다 (교재 글). 개수만
    Log.d("PdfPages", "ocr: blocks=${text.textBlocks.size} lines=${text.textBlocks.sumOf { it.lines.size }}")
    for (block in text.textBlocks) {
      for (line in block.lines) {
        val els = line.elements.filter { it.boundingBox != null }.sortedBy { it.boundingBox!!.left }
        var prevRight = Double.NaN
        var top = 0.0
        var bottom = 0.0
        for (el in els) {
          val b = el.boundingBox!!
          val x0 = b.left * scale
          val x1 = b.right * scale
          top = b.top * scale
          bottom = b.bottom * scale
          if (!prevRight.isNaN()) out.put(box(" ", prevRight, top, x0, bottom))
          val chars = el.text.codePoints().toArray().map { String(Character.toChars(it)) }
          if (chars.isEmpty()) continue
          val w = (x1 - x0) / chars.size
          chars.forEachIndexed { i, c -> out.put(box(c, x0 + w * i, top, x0 + w * (i + 1), bottom)) }
          prevRight = x1
        }
        if (!prevRight.isNaN()) out.put(box("\n", prevRight, top, prevRight, bottom))
      }
    }
    return out.toString()
  }

  private fun box(c: String, x0: Double, y0: Double, x1: Double, y1: Double): JSONArray =
    JSONArray().put(c).put(r2(x0)).put(r2(y0)).put(r2(x1)).put(r2(y1))

  private fun r2(v: Double): Double = Math.round(v * 100.0) / 100.0
}
