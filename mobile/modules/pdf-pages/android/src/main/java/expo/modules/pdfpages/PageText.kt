package expo.modules.pdfpages

import android.graphics.pdf.PdfRenderer
import android.util.Log
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

  /** 쪽의 글만 (상자 없이). 실제 기기의 PdfRenderer는 글만 주고 줄 상자는 비워 줘서 위 json()이 빈 값이 된다 →
   *  자리는 글자 인식(OcrText)에서 얻고, 글자는 이 글로 바로잡는다 (src/notes/textLayer.ts). */
  fun plain(page: PdfRenderer.Page): String {
    val contents = page.textContents
    // 글자 내용은 기록하지 않는다 (교재 글). 개수만: 어느 길로 읽는지 실기기에서 확인하려고
    Log.d("PdfPages", "text layer: contents=${contents.size} boxes=${contents.sumOf { it.bounds.size }} chars=${contents.sumOf { it.text.length }}")
    return contents.joinToString("\n") { it.text }
  }

  private fun r2(v: Float): Double = Math.round(v * 100.0) / 100.0
}
