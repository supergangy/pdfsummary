package expo.modules.pdfpages

import android.graphics.pdf.PdfRenderer
import androidx.annotation.RequiresApi
import org.json.JSONArray

// 안드로이드 15(API 35)의 PdfRenderer 글자 꺼내기. 글자 묶음마다 줄 상자가 오므로 줄 상자를 글자 수로 나눠 글자 상자를 만든다.
@RequiresApi(35)
internal object PageText {
  fun json(page: PdfRenderer.Page): String {
    val out = JSONArray()
    for (content in page.textContents) {
      val lines = content.text.split("\n")
      val boxes = content.bounds
      var li = 0
      for (line in lines) {
        if (li >= boxes.size) break
        val b = boxes[li++]
        val chars = line.toList()
        if (chars.isEmpty()) continue
        val w = (b.right - b.left) / chars.size
        chars.forEachIndexed { i, c ->
          val x0 = b.left + w * i
          out.put(JSONArray().put(c.toString()).put(r2(x0)).put(r2(b.top)).put(r2(x0 + w)).put(r2(b.bottom)))
        }
        out.put(JSONArray().put("\n").put(r2(b.right)).put(r2(b.top)).put(r2(b.right)).put(r2(b.bottom)))
      }
    }
    return out.toString()
  }

  private fun r2(v: Float): Double = Math.round(v * 100.0) / 100.0
}
