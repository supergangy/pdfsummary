package expo.modules.pdfpages

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

// PDF 쪽 크기를 읽고, 쪽을 그림(JPEG)으로 그린다 (안드로이드 기본 PdfRenderer).
class PdfPagesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PdfPages")

    AsyncFunction("infoAsync") { uri: String ->
      open(uri) { r ->
        val out = JSONArray()
        for (i in 0 until r.pageCount) {
          r.openPage(i).use { p -> out.put(JSONObject().put("w", p.width.toDouble()).put("h", p.height.toDouble())) }
        }
        out.toString()
      }
    }

    AsyncFunction("renderAsync") { uri: String, index: Int, widthPx: Int, outPath: String ->
      open(uri) { r ->
        if (index < 0 || index >= r.pageCount) throw CodedException("ERR_PAGE", "${index + 1}쪽이 없어요.", null)
        r.openPage(index).use { p ->
          val w = widthPx.coerceIn(16, 4096)
          val h = Math.max(1, Math.round(w.toDouble() * p.height / Math.max(1, p.width)).toInt())
          val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
          bmp.eraseColor(Color.WHITE)
          p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
          val out = file(outPath)
          out.parentFile?.mkdirs()
          FileOutputStream(out).use { bmp.compress(Bitmap.CompressFormat.JPEG, 88, it) }
          bmp.recycle()
          Uri.fromFile(out).toString()
        }
      }
    }
  }

  private fun file(s: String): File = if (s.startsWith("file://")) File(Uri.parse(s).path!!) else File(s)

  private fun <T> open(uri: String, block: (PdfRenderer) -> T): T {
    val pfd = try {
      ParcelFileDescriptor.open(file(uri), ParcelFileDescriptor.MODE_READ_ONLY)
    } catch (e: Exception) {
      throw CodedException("ERR_OPEN", "PDF를 열 수 없어요.", e)
    }
    val renderer = try {
      PdfRenderer(pfd)
    } catch (e: SecurityException) {
      pfd.close()
      throw CodedException("ERR_LOCKED", "암호가 걸린 PDF예요.", e)
    } catch (e: Exception) {
      pfd.close()
      throw CodedException("ERR_OPEN", "PDF를 열 수 없어요.", e)
    }
    return try {
      synchronized(lock) { block(renderer) }
    } finally {
      renderer.close()
      pfd.close()
    }
  }

  companion object {
    private val lock = Any()   // PdfRenderer는 한 번에 한 쪽만
  }
}
